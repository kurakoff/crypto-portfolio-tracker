import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface DisabledWalletsCtx {
  disabledWallets: Set<number>;
  toggleWallet: (id: number) => void;
}

const Ctx = createContext<DisabledWalletsCtx>({
  disabledWallets: new Set(),
  toggleWallet: () => {},
});

const STORAGE_KEY = 'disabled_wallets';

function loadFromStorage(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as number[]);
  } catch { /* ignore */ }
  return new Set();
}

function saveToStorage(ids: Set<number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function DisabledWalletsProvider({ children }: { children: ReactNode }) {
  const [disabledWallets, setDisabledWallets] = useState<Set<number>>(loadFromStorage);

  const toggleWallet = useCallback((id: number) => {
    setDisabledWallets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveToStorage(next);
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ disabledWallets, toggleWallet }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDisabledWallets() {
  return useContext(Ctx);
}
