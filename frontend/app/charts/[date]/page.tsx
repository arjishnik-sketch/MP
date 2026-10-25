import { ChartWorkspace } from "@/components/chart-workspace";

export default async function ChartDatePage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams?: Promise<{ paper?: string; orient?: string; view?: string }>;
}) {
  const { date } = await params;
  const sp = await searchParams;
  const paper = sp?.paper?.toUpperCase() === "A3" ? "A3" : "A4";
  const orient = sp?.orient?.toUpperCase() === "PORTRAIT" ? "PORTRAIT" : "LANDSCAPE";
  const view = sp?.view?.toUpperCase() === "CONTINUOUS" ? "CONTINUOUS" : "PAGINATED";
  return (
    <ChartWorkspace
      date={date}
      initialPaper={paper}
      initialOrientation={orient}
      initialLayoutMode={view}
    />
  );
}
