import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";

type BoardSearchScope = { publicId: string; name: string } | null;

const BoardSearchScopeContext = createContext<{
  boardScope: BoardSearchScope;
  setBoardScope: (scope: BoardSearchScope) => void;
} | null>(null);

export function BoardSearchScopeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [boardScope, setBoardScope] = useState<BoardSearchScope>(null);

  return (
    <BoardSearchScopeContext.Provider value={{ boardScope, setBoardScope }}>
      {children}
    </BoardSearchScopeContext.Provider>
  );
}

export function useBoardSearchScope() {
  const context = useContext(BoardSearchScopeContext);

  if (!context) {
    throw new Error("useBoardSearchScope must be used within its provider");
  }

  return context;
}
