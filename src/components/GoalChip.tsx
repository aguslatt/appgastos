import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Trophy, XCircle } from 'lucide-react';
import type { GoalTone } from '../lib/goalText';
import { cx } from './cx';

const ICONS = { ok: CheckCircle2, tight: AlertTriangle, off: XCircle, unknown: HelpCircle, done: Trophy, late: Clock } as const;
const CLASS: Record<GoalTone, string> = { ok: 'chip--good', done: 'chip--good', tight: 'chip--warn', late: 'chip--warn', off: 'chip--bad', unknown: '' };

/** Status pill: always an icon plus words, never color alone. */
export function GoalChip({ tone, label }: { tone: GoalTone; label: string }) {
  const Icon = ICONS[tone];
  return (
    <span className={cx('chip', CLASS[tone])}>
      <Icon size={15} aria-hidden="true" />
      {label}
    </span>
  );
}
