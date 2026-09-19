import mark from '../assets/moose-mark.json';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
/** 统一图标按钮的可访问名称和悬浮提示。 */
export function IconButton({
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
/** 封装带标签的 Base UI 下拉选择，统一选项映射与变更回调。 */
export function Picker({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
  title,
  placeholder,
  icon,
}: {
  icon?: ReactNode;
  placeholder?: string;
  title?: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange(value: string): void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(value) => {
        if (value !== null) onChange(value);
      }}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} title={title} className={className}>
        {icon}
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
/** 从共享矢量数据绘制驼鹿标识，与 macOS 应用图标保持同一轮廓。 */
export function MooseMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d={mark.antler} fill="currentColor" />
      <path d={`${mark.head} ${mark.eye}`} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
