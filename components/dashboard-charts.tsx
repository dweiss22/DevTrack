"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
export function DashboardCharts({ statusData }: { statusData: { name: string; tasks: number }[] }) {
  return <section><article className="card chart"><h2>Tasks by status</h2><ResponsiveContainer width="100%" height={250}><BarChart data={statusData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="tasks" fill="var(--blue)" radius={[4,4,0,0]} /></BarChart></ResponsiveContainer></article></section>;
}
