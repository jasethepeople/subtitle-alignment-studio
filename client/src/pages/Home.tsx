import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { formatDistanceToNow } from "date-fns";
import { Archive, ArrowUpRight, Clapperboard, FileAudio, FolderPlus, MoreHorizontal, Search, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

const statusTone: Record<string, string> = {
  draft: "bg-white/[0.06] text-zinc-400",
  queued: "bg-amber-400/10 text-amber-300",
  processing: "bg-sky-400/10 text-sky-300",
  ready: "bg-emerald-400/10 text-emerald-300",
  attention: "bg-orange-400/10 text-orange-300",
  failed: "bg-rose-400/10 text-rose-300",
};

export default function Home() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const { data: projects, isLoading } = trpc.studio.list.useQuery();
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [title, setTitle] = useState("");
  const createProject = trpc.studio.create.useMutation({
    onSuccess: project => {
      utils.studio.list.invalidate();
      navigate(`/studio/${project.project.id}`);
      toast.success("Session created", { description: "Import source media and a subtitle track to begin." });
    },
    onError: error => toast.error("Could not create session", { description: error.message }),
  });
  const deleteProject = trpc.studio.delete.useMutation({
    onSuccess: () => {
      utils.studio.list.invalidate();
      toast.success("Session removed");
    },
    onError: error => toast.error("Could not remove session", { description: error.message }),
  });
  const filteredProjects = useMemo(() => (projects || []).filter(project => project.title.toLowerCase().includes(query.toLowerCase())), [projects, query]);

  function handleCreate() {
    if (!title.trim()) return toast.error("Give the session a title first.");
    createProject.mutate({ title: title.trim(), sourceLanguage: "auto" });
  }

  return (
    <DashboardLayout>
      <section className="min-h-full bg-[#0b0c0f] text-zinc-100">
        <header className="flex min-h-[72px] items-center justify-between border-b border-white/[0.08] px-5 sm:px-8">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.24em] text-sky-300">Post Production / Subtitle Operations</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Subtitle Sessions</h1>
          </div>
          <Button onClick={() => setIsCreating(true)} className="nle-primary h-10 gap-2 rounded-sm px-4 text-xs font-semibold uppercase tracking-[0.14em]">
            <FolderPlus className="h-4 w-4" /> New Session
          </Button>
        </header>

        <div className="mx-auto max-w-[1500px] p-5 sm:p-8">
          {isCreating && (
            <div className="mb-7 grid gap-3 border border-sky-400/30 bg-sky-400/[0.06] p-4 shadow-[0_20px_65px_rgba(0,0,0,0.22)] sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <div>
                <p className="text-sm font-medium">Create a working session</p>
                <p className="mt-1 text-xs text-muted-foreground">Each session keeps its source files, timing passes, translation tracks, and exports isolated.</p>
              </div>
              <Input value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => event.key === "Enter" && handleCreate()} placeholder="Episode 03 · Dialogue pass" className="h-10 min-w-[230px] rounded-sm border-white/10 bg-black/30 text-sm" autoFocus />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setIsCreating(false)} className="rounded-sm text-xs">Cancel</Button>
                <Button onClick={handleCreate} disabled={createProject.isPending} className="nle-primary rounded-sm text-xs">Create</Button>
              </div>
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-[1fr_310px]">
            <div className="border border-white/[0.08] bg-[#111216] shadow-[0_18px_50px_rgba(0,0,0,0.16)]">
              <div className="flex flex-col gap-4 border-b border-white/[0.08] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Active Library</p>
                  <p className="mt-1 text-sm text-zinc-300">Open a session to continue timing, translation, and export work.</p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter sessions" className="h-9 rounded-sm border-white/10 bg-black/30 pl-9 text-xs" />
                </div>
              </div>
              <div className="divide-y divide-white/[0.06]">
                {isLoading && Array.from({ length: 3 }).map((_, index) => <div className="flex gap-4 p-5" key={index}><Skeleton className="h-11 w-11 rounded-sm bg-white/5" /><div className="space-y-2"><Skeleton className="h-4 w-48 bg-white/5" /><Skeleton className="h-3 w-32 bg-white/5" /></div></div>)}
                {!isLoading && filteredProjects.map(project => (
                  <article key={project.id} className="group flex items-center gap-4 p-5 transition-colors hover:bg-white/[0.025]">
                    <div className="grid h-11 w-11 shrink-0 place-items-center border border-white/10 bg-black/30 text-sky-300"><Clapperboard className="h-5 w-5" /></div>
                    <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/studio/${project.id}`)}>
                      <div className="flex items-center gap-2"><h2 className="truncate text-sm font-medium text-zinc-100">{project.title}</h2><span className={`rounded-sm px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusTone[project.status] || statusTone.draft}`}>{project.status}</span></div>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{project.sourceLanguage.toUpperCase()} SOURCE · UPDATED {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true }).toUpperCase()}</p>
                    </button>
                    <Button variant="ghost" onClick={() => navigate(`/studio/${project.id}`)} className="h-9 w-9 rounded-sm p-0 opacity-0 transition-opacity group-hover:opacity-100" aria-label={`Open ${project.title}`}><ArrowUpRight className="h-4 w-4" /></Button>
                    <Button variant="ghost" onClick={() => { if (window.confirm(`Delete “${project.title}”? Stored project metadata will be removed.`)) deleteProject.mutate({ projectId: project.id }); }} className="h-9 w-9 rounded-sm p-0 text-muted-foreground opacity-0 transition-opacity hover:text-rose-300 group-hover:opacity-100" aria-label={`Delete ${project.title}`}><Trash2 className="h-4 w-4" /></Button>
                  </article>
                ))}
                {!isLoading && filteredProjects.length === 0 && (
                  <div className="grid min-h-72 place-items-center p-8 text-center">
                    <div><Archive className="mx-auto h-8 w-8 text-zinc-600" /><p className="mt-4 text-sm font-medium">No subtitle sessions found</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Create a session, then upload an MP4 or MKV source with an SRT or ASS subtitle track.</p></div>
                  </div>
                )}
              </div>
            </div>
            <aside className="border border-white/[0.08] bg-[#111216] p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Studio Pipeline</p>
              <div className="mt-5 space-y-5">
                <PipelineStep icon={<FileAudio className="h-4 w-4" />} number="01" title="Ingest" text="Store source video and subtitle tracks in the session." />
                <PipelineStep icon={<Sparkles className="h-4 w-4" />} number="02" title="Conform" text="Compare waveform onsets and timestamped dialogue." />
                <PipelineStep icon={<MoreHorizontal className="h-4 w-4" />} number="03" title="Deliver" text="Translate style-safe tracks and export mastering files." />
              </div>
            </aside>
          </div>
        </div>
      </section>
    </DashboardLayout>
  );
}

function PipelineStep({ icon, number, title, text }: { icon: React.ReactNode; number: string; title: string; text: string }) {
  return <div className="grid grid-cols-[26px_1fr] gap-3"><span className="grid h-6 w-6 place-items-center border border-white/10 bg-black/30 text-sky-300">{icon}</span><div><p className="font-mono text-[10px] text-zinc-500">{number} / <span className="font-sans text-sm font-medium text-zinc-200">{title}</span></p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div></div>;
}
