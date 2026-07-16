export type ReportingTask = { id: string; status: string; dueDate?: string | null; completedAt?: string | null; plannedMinutes?: number | null; actualMinutes: number; assignees: string[] };
export const isCompleted = (task: ReportingTask) => Boolean(task.completedAt) || /complete|closed|done/i.test(task.status);
export const isOverdue = (task: ReportingTask, now = new Date()) => !isCompleted(task) && Boolean(task.dueDate) && new Date(task.dueDate!) < new Date(now.toDateString());
export function overview(tasks: ReportingTask[]) {
  const completed = tasks.filter(isCompleted); const totalMinutes = tasks.reduce((total, task) => total + task.actualMinutes, 0); const plannedMinutes = tasks.reduce((total, task) => total + (task.plannedMinutes ?? 0), 0);
  return { trackedTasks: tasks.length, completedTasks: completed.length, activeTasks: tasks.length - completed.length, overdueTasks: tasks.filter((task) => isOverdue(task)).length, totalMinutes, plannedMinutes, averageCompletedMinutes: completed.length ? Math.round(totalMinutes / completed.length) : 0, noTimeTasks: tasks.filter((task) => task.actualMinutes === 0).length, overPlanTasks: tasks.filter((task) => task.plannedMinutes != null && task.actualMinutes > task.plannedMinutes).length, contributors: new Set(tasks.flatMap((task) => task.assignees)).size };
}
export const hours = (minutes: number) => Math.round(minutes / 6) / 10;
