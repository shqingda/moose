import mark from '../assets/moose-mark.json';
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
  return <svg viewBox="0 0 100 100" className={className} aria-hidden="true"><path d={mark.antler} fill="currentColor"/><path d={`${mark.head} ${mark.eye}`} fill="currentColor" fillRule="evenodd"/></svg>;
}
