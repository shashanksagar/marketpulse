import Dashboard from "@/components/Dashboard";
import { createInitialData } from "@/lib/market";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Dashboard initialData={createInitialData()} />;
}
