import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { StudioIssue } from "@/core/types";

export function IssueList({ issues, okLabel = "Valid" }: { issues: StudioIssue[]; okLabel?: string }) {
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-primary" />
        <span>{okLabel}</span>
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {errors.map((issue, index) => (
        <li key={index} className="flex gap-2 px-3 py-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <div className="min-w-0 font-mono text-[11px] leading-relaxed">
            <p className="break-words text-foreground">{issue.message}</p>
            <p className="mt-0.5 text-muted-foreground">
              {[
                issue.file && `file ${issue.file}`,
                issue.partial && `partial ${issue.partial}`,
                issue.field && `field ${issue.field}`,
                issue.line != null && `line ${issue.line}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
