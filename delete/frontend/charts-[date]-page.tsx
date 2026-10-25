import { ChartWorkspace } from "@/components/chart-workspace";

export default async function ChartDatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return <ChartWorkspace date={date} />;
}
