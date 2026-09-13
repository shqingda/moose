import type { ComponentProps } from 'react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select';
export function IconButton({ label, children, ...props }: ComponentProps<typeof Button> & { label: string }) {
  return <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} {...props} />}>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
export function Picker({ label, value, options, onChange, disabled, className, title }: { title?: string; label: string; value: string; options: { value: string; label: string }[]; onChange(value: string): void; disabled?: boolean; className?: string }) {
  return <Select value={value} onValueChange={value => { if (value !== null) onChange(value); }} items={options} disabled={disabled}><SelectTrigger aria-label={label} title={title} className={className}><SelectValue /></SelectTrigger><SelectContent alignItemWithTrigger={false}><SelectGroup>{options.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>;
}
export function MooseMark({ className = '' }: { className?: string }) {
  return <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true"><path d="M15 22 8 16 6 8M8 16l-5-2m8 5 1-10m13 13 7-6 2-8m-2 8 5-2m-8 5-1-10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 21c0-3 14-3 14 0l-2 11c-.4 3-9.6 3-10 0l-2-11Z" stroke="currentColor" strokeWidth="2.2"/><path d="M17 26v1m6-1v1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg>;
}
