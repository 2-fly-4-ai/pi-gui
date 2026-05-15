import { useEffect, useMemo, useRef, useState } from "react";

export interface CheckoutSelectorOption {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly current: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

interface CheckoutSelectorProps {
  readonly label: string;
  readonly currentRef: string;
  readonly options: readonly CheckoutSelectorOption[];
}

export function CheckoutSelector({ label, currentRef, options }: CheckoutSelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return options;
    }

    return options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(normalized));
  }, [options, query]);

  return (
    <div className="checkout-selector" ref={rootRef}>
      <div className="checkout-selector__bar">
        <span className="checkout-selector__label">{label}</span>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          className="checkout-selector__button"
          type="button"
          onClick={() => setOpen((current) => !current)}
        >
          <span>{currentRef}</span>
          <span aria-hidden="true">⌄</span>
        </button>
      </div>
      {open ? (
        <div aria-label="Checkout refs" className="checkout-selector__popover" role="dialog">
          <input
            autoFocus
            className="checkout-selector__search"
            placeholder="Search refs…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          <div className="checkout-selector__options">
            {filteredOptions.map((option) => (
              <button
                key={option.id}
                aria-pressed={option.current}
                className={`checkout-selector__option${option.current ? " checkout-selector__option--current" : ""}`}
                disabled={option.disabled}
                type="button"
                onClick={() => {
                  option.onSelect();
                  setOpen(false);
                }}
              >
                <span className="checkout-selector__option-label">{option.label}</span>
                {option.current ? <span className="checkout-selector__current">current</span> : null}
                {option.detail ? <span className="checkout-selector__detail">{option.detail}</span> : null}
              </button>
            ))}
            {filteredOptions.length === 0 ? <div className="checkout-selector__empty">No refs found</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
