"use client";
import { useEffect, useId, useState } from "react";
import { matchingSprints } from "../../lib/sprints";

export function SprintPicker({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel = "Sprint",
}: {
  value: string | null;
  options: string[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputId = useId(),
    listId = useId();
  const choices: { value: string | null; label: string }[] = matchingSprints(
    value ? [...new Set([value, ...options])] : options,
    query,
  ).map((sprint) => ({ value: sprint, label: sprint }));
  if (!query.trim() || "no sprint".includes(query.trim().toLowerCase()))
    choices.push({ value: null, label: "No sprint" });
  const choose = (next: string | null) => {
    if (disabled) return;
    onChange(next);
    setOpen(false);
    setQuery("");
  };
  useEffect(() => {
    if (open)
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({
        block: "nearest",
      });
  }, [active, open, listId]);
  return (
    <div className="field item-picker sprint-picker">
      <label htmlFor={inputId}>Sprint</label>
      <input
        id={inputId}
        aria-label={ariaLabel}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-expanded={open && !disabled}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && !disabled && choices[active] ? `${listId}-${active}` : undefined
        }
        placeholder="No sprint · search a date…"
        disabled={disabled}
        value={open ? query : value || ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setActive(0);
        }}
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) =>
              open ? Math.max(0, Math.min(index + 1, choices.length - 1)) : 0,
            );
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            if (choices[active]) choose(choices[active].value);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && !disabled && (
        <ul id={listId} role="listbox" aria-label={`${ariaLabel} suggestions`}>
          {choices.map((choice, index) => (
            <li
              key={choice.value || "none"}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={active === index}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(choice.value)}
            >
              {choice.label}
            </li>
          ))}
          {!choices.length && (
            <li className="no-matches" role="presentation">
              Enter a date (YYYY-MM-DD) or sprint ID.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
