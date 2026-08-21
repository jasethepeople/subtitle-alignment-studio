import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Clapperboard, Loader2, ShieldCheck, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

export default function Invite() {
  const [, params] = useRoute("/invite/:token");
  const [, navigate] = useLocation();
  const token = params?.token || "";
  const accept = trpc.studio.acceptInvitation.useMutation({
    onSuccess: result => {
      toast.success(`Project access granted: ${result.role}`);
      navigate(`/studio/${result.projectId}`);
    },
    onError: error => toast.error("Invitation could not be accepted", { description: error.message }),
  });
  return <main className="grid min-h-screen place-items-center bg-[#090a0c] p-6 text-zinc-100"><section className="w-full max-w-md border border-white/[0.09] bg-[#111216] p-7 shadow-[0_24px_70px_rgba(0,0,0,.35)]"><div className="grid h-10 w-10 place-items-center border border-sky-300/25 bg-sky-400/[0.08] text-sky-300"><UsersRound className="h-5 w-5" /></div><p className="mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-sky-300">SyncForge collaboration</p><h1 className="mt-2 text-xl font-semibold">Join a subtitle project</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">This invitation is linked to a specific project role and must be accepted while signed in with the email address that received it.</p><div className="mt-5 flex gap-2 border border-white/[0.08] bg-black/20 p-3 text-xs text-zinc-400"><ShieldCheck className="h-4 w-4 shrink-0 text-emerald-300" /><span>Role access is enforced for editing, QA review, approval, and delivery exports.</span></div><Button onClick={() => accept.mutate({ token })} disabled={!token || accept.isPending} className="nle-primary mt-6 h-10 w-full rounded-sm text-xs font-semibold uppercase tracking-widest">{accept.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Clapperboard className="mr-2 h-4 w-4" />}Accept invitation</Button><Button onClick={() => navigate("/")} variant="ghost" className="mt-2 w-full rounded-sm text-xs text-muted-foreground">Return to sessions</Button></section></main>;
}
