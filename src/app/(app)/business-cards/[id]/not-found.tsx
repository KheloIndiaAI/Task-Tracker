import Link from 'next/link';

export default function BusinessCardNotFound() {
  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <div className="rounded-2xl border border-line bg-panel p-8 shadow-card">
        <i className="ti ti-address-book-off text-[32px] text-ink-3 mb-3 block" aria-hidden="true" />
        <h1 className="font-serif text-[20px] text-ink mb-1.5">Contact not found</h1>
        <p className="text-[13px] text-ink-2 leading-relaxed">
          This contact may have been deleted, or you may not have access to it.
        </p>
        <Link
          href="/business-cards"
          className="mt-5 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-ink text-onink text-[13px] font-medium hover:bg-ink-2 transition-colors"
        >
          <i className="ti ti-arrow-left text-[14px]" aria-hidden="true" />
          Back to Business Cards
        </Link>
      </div>
    </div>
  );
}
