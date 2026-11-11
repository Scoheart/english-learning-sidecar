import { badgeVariants } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type TaskStatus = 'complete' | 'pending' | 'processing' | 'failed' | 'skipped' | 'cancelled';

const STATUS_STYLES: Record<TaskStatus, { label: string; className: string }> = {
  pending: {
    label: '排队中',
    className: 'bg-amber-500/10 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  },
  processing: {
    label: '分析中',
    className: 'bg-blue-500/10 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300',
  },
  complete: {
    label: '已完成',
    className: 'bg-emerald-500/10 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300',
  },
  failed: {
    label: '失败',
    className: 'bg-rose-500/10 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300',
  },
  skipped: {
    label: '已跳过',
    className: 'bg-violet-500/10 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300',
  },
  cancelled: {
    label: '已取消',
    className: 'bg-slate-500/10 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  },
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const style = STATUS_STYLES[status] || { label: '未知状态', className: STATUS_STYLES.cancelled.className };
  return (
    <span
      data-task-status={status}
      title={`任务状态：${style.label}`}
      className={cn(
        badgeVariants({ variant: 'outline' }),
        'shrink-0 whitespace-nowrap rounded-md border-transparent px-1.5 py-0.5 text-[10px] font-medium leading-4',
        style.className,
      )}
    >
      {style.label}
    </span>
  );
}
