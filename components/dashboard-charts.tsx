"use client";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type DashboardStatusDatum = { status_id: string | null; name: string; color: string | null; classification: string | null; resolved: boolean; tasks: number };

export function DashboardCharts({ statusData }: { statusData: DashboardStatusDatum[] }) {
  return <section><article className="card chart"><h2>Online Learning projects by status</h2><ResponsiveContainer width="100%" height={250}><BarChart data={statusData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="tasks" radius={[4,4,0,0]}>{statusData.map((status) => <Cell key={status.status_id ?? status.name} fill={status.color ?? (status.resolved ? "var(--blue)" : "#d97706")} />)}</Bar></BarChart></ResponsiveContainer></article></section>;
}
