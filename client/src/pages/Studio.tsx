import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Captions, ChevronLeft, ChevronRight, CirclePlay, Clapperboard, Download, FileAudio, GripVertical, Languages, Loader2, Pause, Play, UploadCloud, WandSparkles } from "lucide-react";
import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link, useLocation, useRoute } from "wouter";

type Waveform = { amplitudes: number[]; bucketDurationMs: number };

function timecode(ms: number) {
  const value = Math.max(0, Math.floor(ms));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1_000);
  const frames = Math.floor((value % 1_000) / 41.6667);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

export default function Studio() {
  const [, params] = useRoute("/studio/:projectId");
  const [, navigate] = useLocation();
  const projectId = params?.projectId;
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.studio.get.useQuery({ projectId: projectId || "missing" }, { enabled: Boolean(projectId) });
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState("es");
  const [waveform, setWaveform] = useState<Waveform | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cuePointerRef = useRef<{ cueId: string; pointerX: number; startMs: number; endMs: number; durationMs: number } | null>(null);
  const updateCue = trpc.studio.updateCue.useMutation({ onSuccess: () => utils.studio.get.invalidate({ projectId }), onError: error => toast.error("Cue update failed", { description: error.message }) });
  const autoAlign = trpc.studio.autoAlign.useMutation({ onSuccess: result => { utils.studio.get.invalidate({ projectId }); toast.success("Alignment pass applied", { description: `${result.matchedMarkers} markers matched · ${result.confidence}% confidence.` }); }, onError: error => toast.error("Alignment needs attention", { description: error.message }) });
  const processVideo = trpc.studio.processVideo.useMutation({ onSuccess: result => { utils.studio.get.invalidate({ projectId }); toast.success("Audio analysis complete", { description: `${result.speechSegments} timestamped speech segments were detected.` }); }, onError: error => toast.error("Media analysis failed", { description: error.message }) });
  const translate = trpc.studio.translate.useMutation({ onSuccess: result => { utils.studio.get.invalidate({ projectId }); setSelectedTrackId(result.targetTrackId); toast.success("Translation track created", { description: `${result.translatedCueCount} cues translated with protected formatting.` }); }, onError: error => toast.error("Translation failed", { description: error.message }) });
  const exportTrack = trpc.studio.export.useMutation({ onSuccess: result => { window.open(result.url, "_blank", "noopener,noreferrer"); toast.success("Export ready", { description: result.filename }); }, onError: error => toast.error("Export failed", { description: error.message }) });

  useEffect(() => {
    if (!data) return;
    setSelectedTrackId(previous => previous && data.tracks.some(track => track.id === previous) ? previous : data.project.activeTrackId || data.tracks[0]?.id || null);
    const waveformAsset = data.assets.find(asset => asset.kind === "waveform");
    if (!waveformAsset) return setWaveform(null);
    let alive = true;
    fetch(waveformAsset.storageUrl).then(response => response.ok ? response.json() : null).then(value => { if (alive && value?.amplitudes) setWaveform(value); }).catch(() => alive && setWaveform(null));
    return () => { alive = false; };
  }, [data]);

  const activeTrack = data?.tracks.find(track => track.id === selectedTrackId) || data?.tracks[0];
  const cues = useMemo(() => data?.cues.filter(cue => cue.trackId === activeTrack?.id) || [], [data, activeTrack?.id]);
  const selectedCue = cues.find(cue => cue.id === selectedCueId) || cues.find(cue => playhead >= cue.startMs && playhead <= cue.endMs) || cues[0];
  const activeCue = cues.find(cue => playhead >= cue.startMs && playhead <= cue.endMs);
  const video = data?.assets.find(asset => asset.kind === "video");
  const durationMs = Math.max(data?.project.durationMs || 0, ...cues.map(cue => cue.endMs), 60_000);
  const isBusy = autoAlign.isPending || processVideo.isPending || translate.isPending;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        void togglePlayback();
        return;
      }
      const seekIncrement = event.shiftKey ? 100 : 1_000;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seek(playhead - seekIncrement);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        seek(playhead + seekIncrement);
        return;
      }
      const currentIndex = selectedCue ? cues.findIndex(cue => cue.id === selectedCue.id) : -1;
      if (event.key === "ArrowUp" && cues.length) {
        event.preventDefault();
        const nextCue = cues[Math.max(0, currentIndex - 1)];
        if (nextCue) { setSelectedCueId(nextCue.id); seek(nextCue.startMs); }
        return;
      }
      if (event.key === "ArrowDown" && cues.length) {
        event.preventDefault();
        const nextCue = cues[Math.min(cues.length - 1, currentIndex + 1)];
        if (nextCue) { setSelectedCueId(nextCue.id); seek(nextCue.startMs); }
        return;
      }
      if ((event.key === "," || event.key === ".") && selectedCue && projectId && !updateCue.isPending) {
        event.preventDefault();
        const delta = event.key === "," ? -100 : 100;
        updateCue.mutate({ projectId, cueId: selectedCue.id, startMs: Math.max(0, selectedCue.startMs + delta), endMs: Math.max(120, selectedCue.endMs + delta), richText: selectedCue.richText });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cues, playhead, projectId, selectedCue, updateCue]);

  function seek(nextMs: number) {
    const value = Math.max(0, Math.min(durationMs, nextMs));
    setPlayhead(value);
    if (videoRef.current) videoRef.current.currentTime = value / 1_000;
  }

  async function togglePlayback() {
    if (!videoRef.current) return;
    if (videoRef.current.paused) { await videoRef.current.play(); setIsPlaying(true); }
    else { videoRef.current.pause(); setIsPlaying(false); }
  }

  async function upload(kind: "video" | "subtitle", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !projectId) return;
    const allowed = kind === "video" ? ["mp4", "mkv"] : ["srt", "ass"];
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !allowed.includes(ext)) return toast.error(`Choose a ${allowed.map(item => `.${item}`).join(" or ")} file.`);
    if (file.size > 45 * 1024 * 1024) return toast.error("Upload exceeds the 45 MB in-request analysis limit.");
    try {
      toast.loading(`Uploading ${file.name}…`, { id: "upload" });
      const response = await fetch("/api/media-upload", { method: "POST", headers: { "content-type": "application/octet-stream", "x-project-id": projectId, "x-file-name": file.name, "x-asset-kind": kind }, body: await file.arrayBuffer() });
      const payload = await response.json() as { error?: string; cueCount?: number };
      if (!response.ok) throw new Error(payload.error || "Upload failed.");
      await Promise.all([utils.studio.get.invalidate({ projectId }), utils.studio.list.invalidate()]);
      toast.success(kind === "subtitle" ? `Subtitle track loaded${payload.cueCount ? ` · ${payload.cueCount} cues` : ""}` : "Video source loaded", { id: "upload" });
    } catch (error) {
      toast.error("Upload failed", { id: "upload", description: error instanceof Error ? error.message : "Please try again." });
    } finally { event.target.value = ""; }
  }

  function startCueDrag(cueId: string, event: PointerEvent<HTMLButtonElement>) {
    const cue = cues.find(item => item.id === cueId);
    if (!cue) return;
    cuePointerRef.current = { cueId, pointerX: event.clientX, startMs: cue.startMs, endMs: cue.endMs, durationMs };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function finishCueDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = cuePointerRef.current;
    if (!drag || !projectId) return;
    const deltaMs = Math.round((event.clientX - drag.pointerX) / (event.currentTarget.parentElement?.clientWidth || 1) * drag.durationMs);
    cuePointerRef.current = null;
    if (Math.abs(deltaMs) < 40) return;
    updateCue.mutate({ projectId, cueId: drag.cueId, startMs: Math.max(0, drag.startMs + deltaMs), endMs: Math.max(120, drag.endMs + deltaMs), richText: cues.find(cue => cue.id === drag.cueId)?.richText || "" });
  }

  if (!projectId) return <DashboardLayout><EmptyStudio onChoose={() => navigate("/")} /></DashboardLayout>;
  if (isLoading) return <DashboardLayout><div className="grid min-h-screen place-items-center bg-[#0b0c0f]"><Loader2 className="h-5 w-5 animate-spin text-sky-300" /></div></DashboardLayout>;
  if (!data || error) return <DashboardLayout><EmptyStudio onChoose={() => navigate("/")} message={error?.message || "This subtitle session is unavailable."} /></DashboardLayout>;

  return <DashboardLayout>
    <section className="flex h-[calc(100vh-0px)] min-h-[720px] flex-col overflow-hidden bg-[#090a0c] text-zinc-100">
      <header className="flex min-h-[60px] items-center gap-3 border-b border-white/[0.08] bg-[#111216] px-4 sm:px-5">
        <Link href="/" className="grid h-8 w-8 place-items-center border border-white/10 text-muted-foreground transition-colors hover:text-white" aria-label="Back to sessions"><ChevronLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{data.project.title}</p><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">ALIGNMENT BAY · {activeTrack?.language?.toUpperCase() || "NO TRACK"} · {activeTrack?.format?.toUpperCase() || "—"}</p></div>
        <div className="hidden items-center gap-2 lg:flex"><StatusChip label={data.project.status} /><div className="h-5 w-px bg-white/10" /><span className="font-mono text-xs text-zinc-400">{timecode(playhead)}</span></div>
        <Button onClick={() => activeTrack && exportTrack.mutate({ projectId, trackId: activeTrack.id, format: "srt" })} disabled={!activeTrack || exportTrack.isPending} variant="outline" className="h-8 rounded-sm border-white/10 bg-white/[0.03] px-3 text-[10px] font-semibold uppercase tracking-wider hover:bg-white/10"><Download className="mr-1.5 h-3.5 w-3.5" />Export</Button>
      </header>

      <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-0 flex-col">
          <div className="grid min-h-0 flex-1 border-b border-white/[0.08] lg:grid-cols-[minmax(0,1fr)_250px]">
            <div className="relative min-h-[280px] bg-[#020304]">
              {video ? <video ref={videoRef} src={video.storageUrl} className="h-full w-full object-contain" onTimeUpdate={event => setPlayhead(event.currentTarget.currentTime * 1000)} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onLoadedMetadata={event => { if (!data.project.durationMs) seek(event.currentTarget.duration * 1000); }} /> : <VideoPlaceholder />}
              <div className="pointer-events-none absolute inset-x-0 bottom-5 px-8 text-center"><div className="mx-auto w-fit max-w-[92%] rounded-sm bg-black/70 px-4 py-2 font-medium text-white shadow-2xl backdrop-blur-sm">{activeCue?.richText || (video ? "No cue at this playhead" : "Load a source video to preview subtitles")}</div></div>
              <div className="absolute left-4 top-4 flex items-center gap-2"><span className="nle-led">REC</span><span className="rounded-sm border border-white/10 bg-black/50 px-2 py-1 font-mono text-[10px] text-zinc-300">{timecode(playhead)}</span></div>
            </div>
            <aside className="border-t border-white/[0.08] bg-[#111216] p-4 lg:border-l lg:border-t-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Alignment Controls</p>
              <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-1">
                <UploadButton accept=".mp4,.mkv,video/mp4,video/x-matroska" label="Import Video" icon={<UploadCloud className="h-3.5 w-3.5" />} onChange={event => upload("video", event)} />
                <UploadButton accept=".srt,.ass,application/x-subrip,text/x-ssa" label="Import Subtitles" icon={<Captions className="h-3.5 w-3.5" />} onChange={event => upload("subtitle", event)} />
              </div>
              <div className="mt-4 space-y-2 border-t border-white/[0.08] pt-4">
                <Button onClick={() => processVideo.mutate({ projectId, language: data.project.sourceLanguage === "auto" ? undefined : data.project.sourceLanguage })} disabled={!video || isBusy} className="nle-action w-full justify-start rounded-sm text-xs"><FileAudio className="mr-2 h-3.5 w-3.5" />Analyze Audio & Speech</Button>
                <Button onClick={() => autoAlign.mutate({ projectId })} disabled={!activeTrack || isBusy} variant="outline" className="w-full justify-start rounded-sm border-white/10 bg-transparent text-xs hover:bg-white/[0.06]"><WandSparkles className="mr-2 h-3.5 w-3.5 text-sky-300" />Auto-correct Timing</Button>
              </div>
              <div className="mt-5 border-t border-white/[0.08] pt-4"><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Source Assessment</p><div className="mt-3 grid grid-cols-2 gap-y-3 text-xs"><InfoStat label="Cues" value={String(cues.length).padStart(2, "0")} /><InfoStat label="Speech markers" value={data.assets.some(asset => asset.kind === "transcription") ? "READY" : "—"} /><InfoStat label="Waveform" value={waveform ? "READY" : "—"} /><InfoStat label="Track" value={activeTrack?.format.toUpperCase() || "—"} /></div></div>
            </aside>
          </div>

          <Timeline waveform={waveform} cues={cues} durationMs={durationMs} playhead={playhead} selectedCueId={selectedCue?.id} onSeek={seek} onSelectCue={setSelectedCueId} onDragStart={startCueDrag} onDragEnd={finishCueDrag} />
          <div className="flex min-h-[64px] items-center justify-between gap-3 border-t border-white/[0.08] bg-[#111216] px-4">
            <div className="flex items-center gap-1"><Button onClick={() => seek(playhead - 2_000)} variant="ghost" className="h-8 w-8 rounded-sm p-0"><ChevronLeft className="h-4 w-4" /></Button><Button onClick={togglePlayback} disabled={!video} className="nle-primary h-9 w-10 rounded-sm p-0">{isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}</Button><Button onClick={() => seek(playhead + 2_000)} variant="ghost" className="h-8 w-8 rounded-sm p-0"><ChevronRight className="h-4 w-4" /></Button></div>
            <div className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:block">{waveform ? "Waveform / Active" : "Waveform / Awaiting Analysis"} · SPACE PLAY · ← → SCRUB · , . NUDGE</div>
            <div className="font-mono text-xs text-zinc-300">{timecode(playhead)}</div>
          </div>
        </div>

        <aside className="min-h-0 overflow-y-auto border-t border-white/[0.08] bg-[#111216] xl:border-l xl:border-t-0">
          <div className="border-b border-white/[0.08] p-4"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Cue Inspector</p><div className="mt-3"><Select value={activeTrack?.id || "none"} onValueChange={setSelectedTrackId}><SelectTrigger className="h-9 rounded-sm border-white/10 bg-black/20 text-xs"><SelectValue placeholder="Choose track" /></SelectTrigger><SelectContent>{data.tracks.map(track => <SelectItem key={track.id} value={track.id}>{track.name} · {track.language.toUpperCase()}</SelectItem>)}</SelectContent></Select></div></div>
          {selectedCue ? <CueInspector cue={selectedCue} projectId={projectId} onSave={values => updateCue.mutate(values)} isSaving={updateCue.isPending} /> : <div className="grid min-h-48 place-items-center p-6 text-center text-xs text-muted-foreground">Import a subtitle track to inspect individual cues.</div>}
          <div className="border-y border-white/[0.08] p-4"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Translation Pass</p><p className="mt-2 text-xs leading-5 text-muted-foreground">The translation pass locks style and markup tokens before requesting contextual dialogue translation.</p><div className="mt-3 flex gap-2"><Select value={targetLanguage} onValueChange={setTargetLanguage}><SelectTrigger className="h-9 flex-1 rounded-sm border-white/10 bg-black/20 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="es">Spanish</SelectItem><SelectItem value="fr">French</SelectItem><SelectItem value="de">German</SelectItem><SelectItem value="ja">Japanese</SelectItem><SelectItem value="ko">Korean</SelectItem></SelectContent></Select><Button onClick={() => activeTrack && translate.mutate({ projectId, sourceTrackId: activeTrack.id, targetLanguage })} disabled={!activeTrack || isBusy} className="nle-primary h-9 rounded-sm px-3"><Languages className="h-4 w-4" /></Button></div></div>
          <div className="p-4"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Deliverables</p><div className="mt-3 grid grid-cols-2 gap-2"><Button onClick={() => activeTrack && exportTrack.mutate({ projectId, trackId: activeTrack.id, format: "srt" })} disabled={!activeTrack || exportTrack.isPending} variant="outline" className="rounded-sm border-white/10 bg-transparent text-[10px] uppercase tracking-wider">.srt</Button><Button onClick={() => activeTrack && exportTrack.mutate({ projectId, trackId: activeTrack.id, format: "ass" })} disabled={!activeTrack || exportTrack.isPending} variant="outline" className="rounded-sm border-white/10 bg-transparent text-[10px] uppercase tracking-wider">.ass</Button></div></div>
        </aside>
      </div>
    </section>
  </DashboardLayout>;
}

function Timeline({ waveform, cues, durationMs, playhead, selectedCueId, onSeek, onSelectCue, onDragStart, onDragEnd }: { waveform: Waveform | null; cues: Array<{ id: string; startMs: number; endMs: number; richText: string; alignmentConfidence: number }>; durationMs: number; playhead: number; selectedCueId?: string; onSeek: (ms: number) => void; onSelectCue: (id: string) => void; onDragStart: (id: string, event: PointerEvent<HTMLButtonElement>) => void; onDragEnd: (event: PointerEvent<HTMLButtonElement>) => void }) {
  const samples = waveform?.amplitudes || [];
  const displayed = samples.length > 500 ? samples.filter((_, index) => index % Math.ceil(samples.length / 500) === 0) : samples;
  return <section className="h-[210px] overflow-hidden bg-[#0e0f12]"><div className="flex h-8 items-center justify-between border-b border-white/[0.08] px-4"><span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Timeline · Dialogue / Primary</span><span className="font-mono text-[9px] text-zinc-500">{timecode(durationMs)}</span></div><div className="relative h-[178px] cursor-crosshair overflow-hidden" onPointerDown={event => { if ((event.target as HTMLElement).closest("button")) return; const rect = event.currentTarget.getBoundingClientRect(); onSeek((event.clientX - rect.left) / rect.width * durationMs); }}>
    <div className="pointer-events-none absolute inset-x-0 top-0 flex h-7 justify-between border-b border-white/[0.06] px-3 font-mono text-[9px] text-zinc-600">{Array.from({ length: 7 }).map((_, index) => <span key={index}>{timecode(index / 6 * durationMs)}</span>)}</div>
    <div className="pointer-events-none absolute inset-x-0 top-7 h-[66px] border-b border-white/[0.06] bg-[linear-gradient(to_right,rgba(255,255,255,.04)_1px,transparent_1px)] bg-[length:8.333%_100%]">
      {displayed.length ? <svg viewBox={`0 0 ${displayed.length} 80`} preserveAspectRatio="none" className="h-full w-full"><path d={displayed.map((amp, index) => `M ${index} ${40 - Math.min(amp, 1) * 36} V ${40 + Math.min(amp, 1) * 36}`).join(" ")} stroke="#62b9df" strokeOpacity=".75" strokeWidth="1" /></svg> : <div className="grid h-full place-items-center font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-600">Analyze source for waveform</div>}
    </div>
    <div className="absolute inset-x-0 top-[103px] bottom-0 border-t border-white/[0.06] bg-[linear-gradient(to_right,rgba(255,255,255,.035)_1px,transparent_1px)] bg-[length:8.333%_100%]">
      {cues.map(cue => <button key={cue.id} onClick={() => onSelectCue(cue.id)} onPointerDown={event => onDragStart(cue.id, event)} onPointerUp={onDragEnd} className={cn("absolute top-3 h-12 overflow-hidden rounded-[2px] border px-2 text-left transition-colors", cue.id === selectedCueId ? "border-sky-300 bg-sky-400/25 text-sky-50" : "border-sky-400/25 bg-sky-400/10 text-sky-100 hover:bg-sky-400/20")} style={{ left: `${cue.startMs / durationMs * 100}%`, width: `${Math.max(2.4, (cue.endMs - cue.startMs) / durationMs * 100)}%` }} title="Drag to retime cue"><span className="flex items-center gap-1 font-mono text-[8px] text-sky-200/70"><GripVertical className="h-3 w-3 shrink-0" />{timecode(cue.startMs)}</span><span className="mt-0.5 block truncate text-[10px] leading-3">{cue.richText}</span></button>)}
    </div>
    <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,.9)]" style={{ left: `${playhead / durationMs * 100}%` }}><span className="absolute -left-1.5 top-0 h-3 w-3 rotate-45 bg-rose-400" /></div>
  </div></section>;
}

function CueInspector({ cue, projectId, onSave, isSaving }: { cue: { id: string; startMs: number; endMs: number; richText: string; alignmentConfidence: number }; projectId: string; onSave: (values: { projectId: string; cueId: string; startMs: number; endMs: number; richText: string }) => void; isSaving: boolean }) {
  const [text, setText] = useState(cue.richText);
  const [start, setStart] = useState(cue.startMs);
  const [end, setEnd] = useState(cue.endMs);
  useEffect(() => { setText(cue.richText); setStart(cue.startMs); setEnd(cue.endMs); }, [cue]);
  return <div className="p-4"><div className="flex items-center justify-between"><span className="font-mono text-[10px] text-zinc-500">CUE {cue.id.slice(0, 6).toUpperCase()}</span><span className="rounded-sm bg-emerald-400/10 px-2 py-0.5 font-mono text-[9px] text-emerald-300">{cue.alignmentConfidence || 0}% CONF</span></div><div className="mt-3 grid grid-cols-2 gap-2"><TimeField label="IN" value={start} onChange={setStart} /><TimeField label="OUT" value={end} onChange={setEnd} /></div><Textarea value={text} onChange={event => setText(event.target.value)} className="mt-3 min-h-28 resize-y rounded-sm border-white/10 bg-black/20 font-mono text-xs leading-5" /><p className="mt-2 text-[10px] leading-4 text-muted-foreground">ASS overrides and rich SRT tags stay within the cue body during edit and export.</p><Button onClick={() => onSave({ projectId, cueId: cue.id, startMs: start, endMs: end, richText: text })} disabled={isSaving || !text.trim()} className="nle-primary mt-3 h-8 w-full rounded-sm text-[10px] font-semibold uppercase tracking-widest">{isSaving ? "Saving" : "Commit Cue"}</Button></div>;
}

function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <label><span className="font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-500">{label}</span><Input type="number" min="0" value={value} onChange={event => onChange(Number(event.target.value))} className="mt-1 h-8 rounded-sm border-white/10 bg-black/20 font-mono text-[10px]" /></label>; }
function UploadButton({ accept, label, icon, onChange }: { accept: string; label: string; icon: React.ReactNode; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) { return <label className="flex h-9 cursor-pointer items-center gap-2 border border-dashed border-white/15 bg-black/20 px-3 text-[10px] font-medium uppercase tracking-wider text-zinc-300 transition-colors hover:border-sky-300/50 hover:text-sky-200">{icon}{label}<input type="file" accept={accept} className="sr-only" onChange={onChange} /></label>; }
function InfoStat({ label, value }: { label: string; value: string }) { return <div><p className="font-mono text-[9px] uppercase tracking-[0.15em] text-zinc-600">{label}</p><p className="mt-0.5 font-mono text-[10px] text-zinc-300">{value}</p></div>; }
function StatusChip({ label }: { label: string }) { return <span className="rounded-sm border border-emerald-300/20 bg-emerald-400/[0.07] px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-emerald-300">{label}</span>; }
function VideoPlaceholder() { return <div className="grid h-full min-h-[280px] place-items-center bg-[radial-gradient(circle_at_50%_45%,#172333_0,transparent_42%),linear-gradient(135deg,#08090c,#111820)]"><div className="text-center"><CirclePlay className="mx-auto h-11 w-11 text-sky-300/80" /><p className="mt-4 text-sm font-medium">Monitor awaiting source</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Import a local MP4 or MKV proxy to activate playback and subtitle overlay preview.</p></div></div>; }
function EmptyStudio({ onChoose, message = "Choose a session from the library to open the alignment workspace." }: { onChoose: () => void; message?: string }) { return <section className="grid min-h-screen place-items-center bg-[#0b0c0f] p-6 text-center"><div><Clapperboard className="mx-auto h-10 w-10 text-sky-300" /><p className="mt-4 text-lg font-medium">Alignment Bay</p><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{message}</p><Button onClick={onChoose} className="nle-primary mt-6 rounded-sm text-xs uppercase tracking-wider">Browse Sessions</Button></div></section>; }
