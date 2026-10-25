import { Badge } from "@/components/ui/badge";

export function ComingSoon({ title, detail }: { title: string; detail: string }) {
  return <section className="coming-soon" aria-label={`${title} coming soon`}><div className="flex items-center gap-2"><h2>{title}</h2><Badge tone="amber">Coming Soon</Badge></div><p>{detail}</p></section>;
}
