"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
export function DashboardCharts({ statusData, memberData }: { statusData: { name: string; tasks: number }[]; memberData: { name: string; hours: number }[] }) {
  return <section className="chart-grid"><article className="card chart"><h2>Tasks by status</h2><ResponsiveContainer width="100%" height={250}><BarChart data={statusData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="tasks" fill="#4263eb" radius={[4,4,0,0]} /></BarChart></ResponsiveContainer></article><article className="card chart"><h2>Recorded hours by team member</h2><ResponsiveContainer width="100%" height={250}><BarChart data={memberData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="hours" fill="#0ca678" radius={[4,4,0,0]} /></BarChart></ResponsiveContainer></article></section>;
}
