import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { HiMagnifyingGlass, HiMiniPlus } from "react-icons/hi2";

import { filterMemberOptions } from "~/utils/member-search";

interface MemberOption {
  key: string;
  value: string;
  selected: boolean;
  leftIcon?: React.ReactNode;
}

interface MemberPickerProps {
  children: React.ReactNode;
  items: MemberOption[];
  onSelect: (key: string) => void;
  onCreate?: () => void;
  createNewItemLabel?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

export default function MemberPicker({
  children,
  items,
  onSelect,
  onCreate,
  createNewItemLabel,
  ariaLabel,
  disabled = false,
}: MemberPickerProps) {
  const [query, setQuery] = useState("");
  const matchingItems = filterMemberOptions(items, query);

  return (
    <Popover className="relative w-full">
      {({ close }) => (
        <>
          <PopoverButton
            type="button"
            aria-label={ariaLabel}
            disabled={disabled}
            className="h-full w-full cursor-pointer text-left focus-visible:outline-none disabled:cursor-not-allowed"
            onClick={() => setQuery("")}
          >
            {children}
          </PopoverButton>
          <PopoverPanel className="absolute left-0 top-full z-50 mt-1 w-56 origin-top-left rounded-md border border-light-200 bg-light-50 shadow-lg ring-1 ring-black/5 dark:border-dark-500 dark:bg-dark-200">
            <div className="relative border-b border-light-200 p-2 dark:border-dark-500">
              <input
                autoFocus
                type="search"
                aria-label={t`Search members`}
                placeholder={t`Search members`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-md border-0 bg-light-100 py-1.5 pl-8 pr-2 text-xs text-light-1000 placeholder:text-light-700 focus:outline-none focus:ring-2 focus:ring-light-700 dark:bg-dark-300 dark:text-dark-1000 dark:placeholder:text-dark-700 dark:focus:ring-dark-700"
              />
              <HiMagnifyingGlass
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-light-700 dark:text-dark-700"
              />
            </div>
            <div className="max-h-[350px] overflow-y-auto p-1">
              {matchingItems.length ? (
                matchingItems.map((item) => (
                  <label
                    key={item.key}
                    className="flex cursor-pointer items-center rounded-[5px] p-2 hover:bg-light-200 dark:hover:bg-dark-300"
                  >
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => onSelect(item.key)}
                      className="h-[14px] w-[14px] rounded bg-transparent"
                    />
                    {item.leftIcon && (
                      <span
                        aria-hidden="true"
                        className="ml-3 flex items-center"
                      >
                        {item.leftIcon}
                      </span>
                    )}
                    <span className="ml-3 text-[12px] text-dark-900">
                      {item.value}
                    </span>
                  </label>
                ))
              ) : (
                <div className="p-2 text-xs text-dark-900">
                  {query.trim() ? t`No members found` : t`No members`}
                </div>
              )}
            </div>
            {onCreate && (
              <div className="border-t border-light-200 p-1 dark:border-dark-500">
                <button
                  type="button"
                  className="flex w-full items-center rounded-[5px] p-2 text-xs text-dark-900 hover:bg-light-200 dark:hover:bg-dark-300"
                  onClick={() => {
                    close();
                    onCreate();
                  }}
                >
                  <HiMiniPlus size={20} className="pr-1.5" />
                  {createNewItemLabel}
                </button>
              </div>
            )}
          </PopoverPanel>
        </>
      )}
    </Popover>
  );
}
