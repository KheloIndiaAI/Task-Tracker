# Deployment

Production runs on **AWS account `114171679953`**, region **ap-south-1 (Mumbai)**,
on **ECS Fargate** behind an Application Load Balancer. Deploys are automated by
GitHub Actions and triggered by pushing to the **`dev`** branch.

## Architecture

```
GoDaddy DNS: tt.ccki.in  CNAME -> tt-alb-1703421926.ap-south-1.elb.amazonaws.com
      |
  [ Internet ]
      |
  Application Load Balancer (tt-alb)  +  WAFv2 (tt-waf)
      |   HTTPS:443 (ACM cert)  /  HTTP:80 -> 301 redirect
      v
  ECS Fargate service (tt-service, ARM64)   cluster tt-cluster
      |   2 tasks, auto-scaling min 1 / max 6, target CPU 60%
      |   private subnets, NAT egress, container port 3000
      +--> RDS PostgreSQL 16 (tt-postgres, private, encrypted, single-AZ)
      +--> S3 bucket task-tracker-storage-bucket (attachments)

  Secrets Manager: task-tracker/app   (all runtime env; injected into the task)
  EventBridge:     whatsapp-drain (every 1 min), due-notifications (09:00 IST daily)
```

The container is a plain `next build` + `next start` image (see `Dockerfile`),
built for **linux/arm64** and stored in ECR
(`114171679953.dkr.ecr.ap-south-1.amazonaws.com/task-tracker`).

## CI/CD

Workflow: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

- **Trigger:** push to **`dev`** only. Pushing to `main` does **not** deploy.
- **Auth:** GitHub OIDC → assumes IAM role `tt-github-deploy` in the AWS account.
  No AWS access keys are stored in GitHub.
- **Jobs:**
  1. `quality-gate` — `pnpm install`, `prisma generate`, `tsc --noEmit`, `next lint`, `pnpm audit`.
  2. `deploy` —
     - build the arm64 image (Buildx + QEMU) and push `:latest` and `:<sha>` to ECR;
     - register a new task-definition revision pointing at the `:<sha>` image;
     - run `prisma migrate deploy` as a **one-off ECS task** (RDS is private, so
       migrations run inside the VPC, not on the GitHub runner);
     - update the service to the new revision and wait for it to stabilize.

### To deploy

```bash
git checkout dev
git merge main          # or commit your changes on dev
git push origin dev     # triggers the pipeline
```

Watch progress in the repo's **Actions** tab.

### Rollback

Every deploy registers an immutable task-definition revision. To roll back, point
the service at a previous revision:

```bash
aws ecs update-service --cluster tt-cluster --service tt-service \
  --task-definition tt-task:<previous-revision> \
  --profile <profile> --region ap-south-1
```

## Configuration & secrets

All runtime env lives in **AWS Secrets Manager** secret `task-tracker/app`
(DATABASE_URL, DIRECT_URL, AUTH_SECRET, S3_*, SANDESHA_API_KEY, CRON_SECRET, …).
The ECS task definition injects each key at container start. To change a value:

```bash
# fetch, edit, and put back the JSON secret, then roll the service
aws secretsmanager get-secret-value --secret-id task-tracker/app --query SecretString --output text > secret.json
# edit secret.json ...
aws secretsmanager put-secret-value --secret-id task-tracker/app --secret-string file://secret.json
aws ecs update-service --cluster tt-cluster --service tt-service --force-new-deployment
rm -f secret.json
```

Never commit real secrets. Local development uses `.env` (see [CLAUDE.md](../CLAUDE.md)).

## Scheduled jobs

Two EventBridge rules call the cron endpoints with `Authorization: Bearer <CRON_SECRET>`:

- `tt-whatsapp-drain-rule` — `rate(1 minute)` → `GET /api/cron/whatsapp-drain`
- `tt-due-notifications-rule` — `cron(30 3 * * ? *)` (09:00 IST) → `GET /api/cron/due-notifications`

## Infrastructure

The AWS infrastructure (VPC, subnets, security groups, RDS, S3, ALB, WAF, ECS,
IAM roles, ECR, Secrets Manager, EventBridge, budgets) was provisioned via the
AWS CLI. The full provisioning and migration runbook (with every resource ID and
the operational scripts) is maintained outside the repo by the platform owner.

### Health & logs

```bash
aws ecs describe-services --cluster tt-cluster --services tt-service \
  --query 'services[0].{running:runningCount,desired:desiredCount}'
aws elbv2 describe-target-health --target-group-arn <tt-tg-arn> \
  --query 'TargetHealthDescriptions[].TargetHealth.State'
aws logs tail /ecs/tt-task --since 15m
```
