import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

interface MenuPosition {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
}

const MENU_GUTTER = 8;
const MENU_MAX_HEIGHT = 288;
const MENU_MIN_WIDTH = 224;

/**
 * A small, dependency-free listbox styled after the shadcn controls. The menu
 * is portalled to <body> so the Preferences dialog's scroll container cannot
 * clip it, and it flips above the trigger when there is not enough room below.
 */
export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      id,
      value,
      onValueChange,
      options,
      disabled = false,
      placeholder = "请选择",
      className,
      "aria-label": ariaLabel,
      "aria-describedby": ariaDescribedBy,
    },
    forwardedRef,
  ) => {
    const [open, setOpen] = React.useState(false);
    const [activeIndex, setActiveIndex] = React.useState(0);
    const [position, setPosition] = React.useState<MenuPosition | null>(null);

    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const menuRef = React.useRef<HTMLDivElement | null>(null);
    const optionRefs = React.useRef<Array<HTMLDivElement | null>>([]);
    const listboxId = React.useId();

    const selectedIndex = options.findIndex((option) => option.value === value);
    const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

    const setTriggerRef = React.useCallback(
      (node: HTMLButtonElement | null) => {
        triggerRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const moveActive = React.useCallback(
      (direction: 1 | -1) => {
        setActiveIndex((current) => {
          for (let step = 1; step <= options.length; step += 1) {
            const next = (current + direction * step + options.length * step) % options.length;
            if (!options[next]?.disabled) return next;
          }
          return current;
        });
      },
      [options],
    );

    const choose = React.useCallback(
      (index: number) => {
        const option = options[index];
        if (!option || option.disabled) return;
        onValueChange(option.value);
        setOpen(false);
        triggerRef.current?.focus();
      },
      [onValueChange, options],
    );

    const toggle = React.useCallback(() => {
      if (disabled) return;
      setOpen((current) => {
        if (!current) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
        return !current;
      });
    }, [disabled, selectedIndex]);

    React.useLayoutEffect(() => {
      if (!open) {
        setPosition(null);
        return;
      }

      const placeMenu = () => {
        const trigger = triggerRef.current;
        if (!trigger) return;

        const rect = trigger.getBoundingClientRect();
        const width = Math.min(
          Math.max(rect.width, MENU_MIN_WIDTH),
          window.innerWidth - MENU_GUTTER * 2,
        );
        const left = Math.min(
          Math.max(MENU_GUTTER, rect.left),
          window.innerWidth - width - MENU_GUTTER,
        );

        // scrollHeight is the natural content height even while maxHeight clips it.
        const contentHeight = Math.min(
          menuRef.current?.scrollHeight ?? 0,
          MENU_MAX_HEIGHT,
        );
        const spaceBelow = window.innerHeight - rect.bottom - MENU_GUTTER;
        const spaceAbove = rect.top - MENU_GUTTER;
        const openUp = contentHeight > spaceBelow && spaceAbove > spaceBelow;

        setPosition({
          left,
          top: openUp
            ? Math.max(MENU_GUTTER, rect.top - contentHeight - 6)
            : rect.bottom + 6,
          width,
          maxHeight: Math.max(
            96,
            Math.min(contentHeight || MENU_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow),
          ),
          placement: openUp ? "top" : "bottom",
        });
      };

      placeMenu();
      window.addEventListener("resize", placeMenu);
      window.addEventListener("scroll", placeMenu, true);
      return () => {
        window.removeEventListener("resize", placeMenu);
        window.removeEventListener("scroll", placeMenu, true);
      };
    }, [open]);

    React.useEffect(() => {
      if (!open) return;
      const onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (!target) return;
        if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
        setOpen(false);
      };
      document.addEventListener("pointerdown", onPointerDown, true);
      return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [open]);

    React.useEffect(() => {
      if (!open) return;
      optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, open]);

    const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return;

      if (!open) {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
          setOpen(true);
        }
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveActive(1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveActive(-1);
          break;
        case "Home":
          event.preventDefault();
          setActiveIndex(options.findIndex((option) => !option.disabled));
          break;
        case "End":
          event.preventDefault();
          setActiveIndex(options.map((option) => !option.disabled).lastIndexOf(true));
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          choose(activeIndex);
          break;
        case "Escape":
          event.preventDefault();
          // Keep Escape local to the menu so an enclosing dialog stays open.
          event.stopPropagation();
          setOpen(false);
          break;
        case "Tab":
          setOpen(false);
          break;
        default:
          break;
      }
    };

    return (
      <>
        <button
          ref={setTriggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          onClick={toggle}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "group inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-xs text-foreground shadow-2xs outline-none transition-[color,border-color,box-shadow,background-color] duration-200",
            "hover:border-primary/40 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className={cn("flex min-w-0 flex-1 items-center gap-2 truncate", !selectedOption && "text-muted-foreground/70")}>
            <span className="font-medium text-foreground">{selectedOption?.label ?? placeholder}</span>
            {selectedOption?.description && (
              <span className="truncate text-[11px] text-muted-foreground">
                · {selectedOption.description}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180 text-foreground",
            )}
            aria-hidden="true"
          />
        </button>

        {open &&
          position &&
          createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              data-sidecar-select-content=""
              className={cn(
                // Radix Dialog sets `pointer-events: none` on <body> for modals;
                // the portalled menu must opt back in or it renders but clicks pass through.
                "animate-dropdown-in pointer-events-auto fixed z-[100] overflow-y-auto overscroll-contain rounded-xl border border-border/80 bg-popover p-1 text-popover-foreground shadow-xl",
                position.placement === "top" ? "origin-bottom" : "origin-top",
              )}
              style={{
                left: position.left,
                top: position.top,
                width: position.width,
                maxHeight: position.maxHeight,
              }}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                const isActive = index === activeIndex;
                return (
                  <div
                    key={option.value}
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    id={`${listboxId}-option-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    data-active={isActive || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors",
                      isActive && "bg-accent text-accent-foreground",
                      option.disabled && "pointer-events-none opacity-40",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{option.label}</span>
                      {option.description && (
                        <span
                          className={cn(
                            "mt-0.5 block truncate text-[11px]",
                            isActive ? "text-accent-foreground/70" : "text-muted-foreground",
                          )}
                        >
                          {option.description}
                        </span>
                      )}
                    </span>
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-primary",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                  </div>
                );
              })}
            </div>,
            document.body,
          )}
      </>
    );
  },
);

Select.displayName = "Select";
