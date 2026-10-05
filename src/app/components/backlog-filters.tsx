"use client";
import { PRIORITIES, STATES, STATE_LABELS } from "../../lib/project-types";
import { defaultFilters, type ListFilters } from "../../lib/list-view";

export function MineFilter({
  filters,
  change,
  className = "",
}: {
  filters: ListFilters;
  change: (filters: ListFilters) => void;
  className?: string;
}) {
  return (
    <label
      className={`filter-toggle${filters.mine ? " selected" : ""}${className ? ` ${className}` : ""}`}
    >
      <input
        type="checkbox"
        checked={filters.mine}
        onChange={(event) => change({ ...filters, mine: event.target.checked })}
      />
      My tickets
    </label>
  );
}
export function BacklogFilters({
  filters,
  change,
}: {
  filters: ListFilters;
  change: (filters: ListFilters) => void;
}) {
  return (
    <div className="backlog-filters" role="region" aria-label="Backlog filters">
      <div className="backlog-filter-controls">
        <label className="filter-field filter-class">
          Ticket class
          <select
            aria-label="Ticket class"
            value={filters.ticketClass}
            onChange={(event) =>
              change({
                ...filters,
                ticketClass: event.target.value as ListFilters["ticketClass"],
              })
            }
          >
            <option value="all">All</option>
            <option value="feature">Features</option>
            <option value="bug">Bugs</option>
          </select>
        </label>
        <fieldset className="severity-filter">
          <legend>Severity</legend>
          <div className="severity-options">
            {PRIORITIES.map((priority) => (
              <label
                key={priority}
                className={`severity-option${filters.severities.includes(priority) ? " selected" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={filters.severities.includes(priority)}
                  onChange={(event) =>
                    change({
                      ...filters,
                      severities: event.target.checked
                        ? [...filters.severities, priority]
                        : filters.severities.filter(
                            (value) => value !== priority,
                          ),
                    })
                  }
                />
                {priority}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="filter-field filter-search">
          Search
          <input
            type="search"
            aria-label="Search items"
            placeholder="Title, description, or SAV ID…"
            value={filters.search}
            onChange={(event) =>
              change({ ...filters, search: event.target.value })
            }
          />
        </label>
        <label className="filter-field filter-state">
          State
          <select
            aria-label="Filter by state"
            value={filters.state}
            onChange={(event) =>
              change({
                ...filters,
                state: event.target.value as ListFilters["state"],
              })
            }
          >
            <option value="">All states</option>
            {STATES.map((state) => (
              <option key={state} value={state}>
                {STATE_LABELS[state]}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-field filter-sort">
          Sort by
          <select
            aria-label="Sort by"
            value={filters.sort}
            onChange={(event) =>
              change({
                ...filters,
                sort: event.target.value as ListFilters["sort"],
              })
            }
          >
            <option value="priority">Severity first</option>
            <option value="newest">Most recently added</option>
          </select>
        </label>
        <MineFilter
          filters={filters}
          change={change}
          className="filter-mine"
        />
      </div>
      <div className="backlog-filter-summary">
        <span>
          {filters.severities.length === 4
            ? "All severities"
            : filters.severities.length
              ? PRIORITIES.filter((value) =>
                  filters.severities.includes(value),
                ).join(", ")
              : "No severities selected"}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => change(defaultFilters())}
        >
          Reset filters
        </button>
      </div>
    </div>
  );
}
