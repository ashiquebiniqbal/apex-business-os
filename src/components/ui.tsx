import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">{subtitle}</p>
      </div>
      {children && <div className="flex shrink-0 flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function primaryButtonClass(disabled = false): string {
  return `rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-white${disabled ? " cursor-not-allowed opacity-50" : ""}`;
}

export function secondaryButtonClass(): string {
  return "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700";
}

export function LoadingBlock({ message }: { message: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">{message}</div>;
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyBlock({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <h2 className="font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{message}</p>
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function MigrationNotice({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
      <p className="font-semibold">Database migration pending</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-accent sm:max-w-sm"
    />
  );
}

export function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-slate-900/30 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>
          <button onClick={onClose} className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm text-slate-500" aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel, busy, onConfirm, onCancel }: { title: string; message: string; confirmLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} subtitle={message} onClose={onCancel}>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className={secondaryButtonClass()}>
          Cancel
        </button>
        <button onClick={onConfirm} disabled={busy} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-4 block text-xs font-medium text-slate-500 first:mt-0">
      {label}
      {children}
    </label>
  );
}

export function FormErrors({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
      <ul className="list-disc space-y-1 pl-5">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

const PILL_TONES: Record<string, string> = {
  new: "bg-blue-50 text-accent",
  processing: "bg-amber-50 text-amber-700",
  proposal: "bg-violet-50 text-violet-700",
  draft: "bg-slate-100 text-slate-600",
  pending_approval: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  sent: "bg-blue-50 text-accent",
  accepted: "bg-emerald-50 text-emerald-700",
  won: "bg-emerald-50 text-emerald-700",
  open: "bg-blue-50 text-accent",
  proposed: "bg-violet-50 text-violet-700",
  done: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
  lost: "bg-red-50 text-red-700",
  dismissed: "bg-slate-100 text-slate-500",
  closed: "bg-slate-100 text-slate-500",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  reserved: "bg-amber-50 text-amber-700",
  unpriced: "bg-slate-100 text-slate-500",
};

export function StatusPill({ status }: { status: string }) {
  const tone = PILL_TONES[status] ?? "bg-slate-100 text-slate-600";
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{status.replace(/_/g, " ")}</span>;
}

export function DemoBadge() {
  return (
    <span title="Fictional demonstration record" className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[11px] font-semibold text-amber-800">
      Demo
    </span>
  );
}

export function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={`mt-1 break-words text-sm font-medium text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
