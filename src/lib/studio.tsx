import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import type { StoreView } from "@/core/pipeline";
import type { CommitInfo, DocKind, StoreDoc, StoreSnapshot } from "@/core/types";
import { isDraftDirty } from "@/core/drafts";

import { connect, DEFAULT_LOCAL_API, type StudioApi } from "./api";

type DraftMap = Record<string, string>;

interface StudioContextValue {
  api: StudioApi | null;
  mode: "local" | "demo" | "connecting";
  storePath: string;
  connectionNote: string;
  snapshot: StoreSnapshot | null;
  loading: boolean;
  error: string | null;
  /** Current content including unsaved edits. */
  content(kind: DocKind, name: string): string;
  isDirty(kind: DocKind, name: string): boolean;
  setDraft(kind: DocKind, name: string, content: string): void;
  discard(kind: DocKind, name: string): void;
  save(kind: DocKind, name: string): Promise<CommitInfo | null>;
  create(kind: DocKind, name: string, content: string): Promise<void>;
  remove(kind: DocKind, name: string): Promise<void>;
  applyRestored(kind: DocKind, name: string, content: string): void;
  /** Increments whenever a version is restored, so editors reload their structured state. */
  restoreTick: number;
  reload(): Promise<void>;
  /** Fragments / partials / helpers as the render pipeline wants them, drafts included. */
  view: StoreView;
  list(kind: DocKind): StoreDoc[];
  catalogDirectory: string;
  setCatalogDirectory(directory: string): void;
  createDirectory(name: string): Promise<void>;
  removeDirectory(directory: string): Promise<void>;
  moveDoc(kind: "fragment" | "partial" | "helper", name: string, directory: string): Promise<void>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const key = (kind: DocKind, name: string) => `${kind}:${name}`;

export function StudioProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<StudioApi | null>(null);
  const [mode, setMode] = useState<"local" | "demo" | "connecting">("connecting");
  const [connectionNote, setConnectionNote] = useState("");
  const [snapshot, setSnapshot] = useState<StoreSnapshot | null>(null);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [restoreTick, setRestoreTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogDirectory, setCatalogDirectory] = useState("catalog");
  const apiRef = useRef<StudioApi | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { api: resolved, reason } = await connect();
      if (cancelled) return;
      apiRef.current = resolved;
      setApi(resolved);
      setMode(resolved.mode);
      setConnectionNote(
        resolved.mode === "local"
          ? `local server at ${DEFAULT_LOCAL_API}`
          : (reason ?? "local server unreachable"),
      );
      try {
        setSnapshot(await resolved.getStore());
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!apiRef.current) return;
    try {
      setSnapshot(await apiRef.current.getStore());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const list = useCallback(
    (kind: DocKind): StoreDoc[] => {
      if (!snapshot) return [];
      switch (kind) {
        case "profile":
          return snapshot.profiles;
        case "fragment":
          return snapshot.fragments;
        case "partial":
          return snapshot.partials;
        case "helper":
          return snapshot.helpers;
        case "targets":
          return [{ name: "targets", content: snapshot.targets }];
      }
    },
    [snapshot],
  );

  const saved = useCallback(
    (kind: DocKind, name: string) => list(kind).find((d) => d.name === name)?.content ?? "",
    [list],
  );

  const content = useCallback(
    (kind: DocKind, name: string) => drafts[key(kind, name)] ?? saved(kind, name),
    [drafts, saved],
  );

  const isDirty = useCallback(
    (kind: DocKind, name: string) => {
      const draft = drafts[key(kind, name)];
      return isDraftDirty(saved(kind, name), draft);
    },
    [drafts, saved],
  );

  const setDraft = useCallback((kind: DocKind, name: string, next: string) => {
    setDrafts((prev) => ({ ...prev, [key(kind, name)]: next }));
  }, []);

  const discard = useCallback((kind: DocKind, name: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key(kind, name)];
      return next;
    });
  }, []);

  const save = useCallback(
    async (kind: DocKind, name: string) => {
      if (!apiRef.current) return null;
      try {
        const commit = await apiRef.current.saveDoc(kind, name, content(kind, name));
        await reload();
        discard(kind, name);
        toast.success(`Saved ${name}`, {
          description: !commit
            ? "written to the external targets file (outside this store, so no version history here)"
            : apiRef.current.mode === "local"
              ? `git commit ${commit.oid.slice(0, 8)}`
              : `demo snapshot ${commit.oid} (nothing written to disk)`,
        });

        return commit;
      } catch (err) {
        toast.error(`Could not save ${name}`, { description: (err as Error).message });
        return null;
      }
    },
    [content, discard, reload],
  );

  const create = useCallback(
    async (kind: DocKind, name: string, initial: string) => {
      if (!apiRef.current) return;
      try {
        await apiRef.current.saveDoc(
          kind,
          name,
          initial,
          kind === "fragment" || kind === "partial" || kind === "helper"
            ? catalogDirectory
            : undefined,
        );
        await reload();
        toast.success(`Created ${name}`);
      } catch (err) {
        toast.error(`Could not create ${name}`, { description: (err as Error).message });
        throw err;
      }
    },
    [catalogDirectory, reload],
  );

  const createDirectory = useCallback(
    async (name: string) => {
      if (!apiRef.current) return;
      const directory = `${catalogDirectory}/${name}`;
      await apiRef.current.createDirectory(directory);
      setCatalogDirectory(directory);
      await reload();
    },
    [catalogDirectory, reload],
  );

  const removeDirectory = useCallback(
    async (directory: string) => {
      if (!apiRef.current) return;
      await apiRef.current.deleteDirectory(directory);
      setCatalogDirectory("catalog");
      await reload();
    },
    [reload],
  );

  const moveDoc = useCallback(
    async (kind: "fragment" | "partial" | "helper", name: string, directory: string) => {
      if (!apiRef.current) return;
      await apiRef.current.moveDoc(kind, name, directory);
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (kind: DocKind, name: string) => {
      if (!apiRef.current) return;
      try {
        await apiRef.current.deleteDoc(kind, name);
        discard(kind, name);
        await reload();
        toast.success(`Deleted ${name}`);
      } catch (err) {
        toast.error(`Could not delete ${name}`, { description: (err as Error).message });
      }
    },
    [discard, reload],
  );

  const applyRestored = useCallback(
    (kind: DocKind, name: string, restored: string) => {
      // The server already wrote and committed the restored bytes; drop the draft, pull the
      // store again, and bump the tick so open editors rebuild from the restored file.
      discard(kind, name);
      void restored;
      void reload().then(() => setRestoreTick((n) => n + 1));
    },
    [discard, reload],
  );

  const view = useMemo<StoreView>(() => {
    const build = (kind: DocKind) =>
      Object.fromEntries(list(kind).map((doc) => [doc.name, content(kind, doc.name)]));
    const paths = (kind: DocKind) =>
      Object.fromEntries(
        list(kind)
          .filter((doc) => doc.path)
          .map((doc) => [doc.name, doc.path!]),
      );
    return {
      fragments: build("fragment"),
      partials: build("partial"),
      helpers: build("helper"),
      fragmentPaths: paths("fragment"),
      partialPaths: paths("partial"),
      helperPaths: paths("helper"),
    };
  }, [content, list]);

  const value = useMemo<StudioContextValue>(
    () => ({
      api,
      mode,
      storePath: snapshot?.storePath ?? "",
      connectionNote,
      snapshot,
      loading,
      error,
      content,
      isDirty,
      setDraft,
      discard,
      save,
      create,
      remove,
      applyRestored,
      restoreTick,
      reload,
      view,
      list,
      catalogDirectory,
      setCatalogDirectory,
      createDirectory,
      removeDirectory,
      moveDoc,
    }),
    [
      api,
      applyRestored,
      connectionNote,
      catalogDirectory,
      content,
      create,
      createDirectory,
      discard,
      error,
      isDirty,
      list,
      loading,
      mode,
      reload,
      remove,
      removeDirectory,
      restoreTick,
      save,
      setDraft,
      moveDoc,
      snapshot,
      view,
    ],
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used inside <StudioProvider>");
  return ctx;
}
