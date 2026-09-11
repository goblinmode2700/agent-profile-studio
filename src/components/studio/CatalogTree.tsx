import { hotkeysCoreFeature, selectionFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { ChevronRight, File, Folder, FolderPlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocKind } from "@/core/types";
import { useStudio } from "@/lib/studio";
import { cn } from "@/lib/utils";

type CatalogKind = "fragment" | "partial" | "helper";
interface ItemData {
  id: string;
  name: string;
  path: string;
  folder: boolean;
  kind?: CatalogKind;
}

export function CatalogTree() {
  const {
    snapshot,
    list,
    catalogDirectory,
    setCatalogDirectory,
    createDirectory,
    removeDirectory,
    moveDoc,
  } = useStudio();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const items = useMemo(() => {
    const map = new Map<string, ItemData>();
    for (const path of snapshot?.catalogDirectories ?? ["catalog"])
      map.set(path, { id: path, name: path.split("/").at(-1)!, path, folder: true });
    for (const kind of ["fragment", "partial", "helper"] as const)
      for (const doc of list(kind)) {
        const path = doc.path ?? `catalog/${kind}/${doc.name}`;
        map.set(path, { id: path, name: doc.name, path, folder: false, kind });
      }
    return map;
  }, [list, snapshot?.catalogDirectories]);
  const children = (id: string) =>
    [...items.values()]
      .filter((item) => item.id !== id && item.path.slice(0, item.path.lastIndexOf("/")) === id)
      .map((item) => item.id);
  const tree = useTree<ItemData>({
    rootItemId: "catalog",
    initialState: { expandedItems: snapshot?.catalogDirectories ?? ["catalog"] },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().folder,
    dataLoader: { getItem: (id) => items.get(id)!, getChildren: children },
    indent: 12,
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });
  const itemKey = [...items.keys()].join("|");
  useEffect(() => {
    tree.rebuildTree();
  }, [itemKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return;
    void createDirectory(name).then(() => {
      setName("");
      setAdding(false);
    });
  };

  return (
    <div className="min-h-0 border-t">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {catalogDirectory}
        </span>
        <Button size="xs" variant="ghost" title="New folder" onClick={() => setAdding((v) => !v)}>
          <FolderPlus className="size-3" />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          title="Remove selected empty folder"
          disabled={catalogDirectory === "catalog"}
          onClick={() => void removeDirectory(catalogDirectory)}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
      {adding && (
        <div className="flex gap-1 px-2 pb-1.5">
          <Input
            autoFocus
            className="h-6 font-mono text-[10px]"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="folder-name"
          />
          <Button size="xs" onClick={submit}>
            Add
          </Button>
        </div>
      )}
      <div {...tree.getContainerProps()} className="max-h-64 overflow-auto px-1 pb-2">
        {tree.getItems().map((item) => {
          const data = item.getItemData();
          const currentDir = data.path.slice(0, data.path.lastIndexOf("/"));
          return (
            <div
              {...item.getProps()}
              key={item.getId()}
              style={{ paddingLeft: `${item.getItemMeta().level * 12}px` }}
              className={cn(
                "group flex min-w-0 items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] hover:bg-muted/60",
                data.folder && catalogDirectory === data.path && "bg-accent",
              )}
              onClick={() => {
                if (data.folder) {
                  setCatalogDirectory(data.path);
                  if (item.isExpanded()) item.collapse();
                  else item.expand();
                }
              }}
            >
              {data.folder ? (
                <>
                  <ChevronRight
                    className={cn("size-3 shrink-0", item.isExpanded() && "rotate-90")}
                  />
                  <Folder className="size-3 shrink-0" />
                </>
              ) : (
                <File className="ml-3 size-3 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{data.name}</span>
              {!data.folder && data.kind && (
                <select
                  aria-label={`Move ${data.name}`}
                  value={currentDir}
                  title="Move document"
                  className="hidden max-w-20 bg-background text-[9px] group-hover:block"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => void moveDoc(data.kind!, data.name, e.target.value)}
                >
                  {(snapshot?.catalogDirectories ?? ["catalog"]).map((directory) => (
                    <option key={directory} value={directory}>
                      {directory.replace(/^catalog\/?/, "") || "catalog"}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
