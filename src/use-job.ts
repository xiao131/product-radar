import { useEffect, useState } from "react";
import type { JobRun } from "../shared/types";
import { api } from "./api";
import { useI18n } from "./i18n";

export function useJobPolling(jobId: string | null) {
  const { t } = useI18n();
  const [job, setJob] = useState<JobRun | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setJob(null);
    setError("");
    if (!jobId) return;

    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    let controller: AbortController | undefined;

    const schedule = () => {
      if (cancelled || document.hidden) return;
      const delay = Math.min(10_000, 1_000 * 2 ** Math.min(attempts, 3));
      timer = window.setTimeout(poll, delay);
    };

    const poll = async () => {
      if (cancelled || document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await api<JobRun>(`/api/jobs/${jobId}`, {
          signal: controller.signal,
        });
        if (cancelled) return;
        setJob(next);
        setError("");
        if (next.status === "RUNNING") {
          schedule();
          attempts += 1;
        }
      } catch (caught) {
        if (cancelled || (caught instanceof DOMException && caught.name === "AbortError")) return;
        attempts += 1;
        setError(caught instanceof Error ? caught.message : t("任务状态读取失败", "Failed to read job status"));
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== undefined) window.clearTimeout(timer);
        timer = undefined;
        controller?.abort();
      } else {
        void poll();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [jobId, t]);

  return { job, error };
}
