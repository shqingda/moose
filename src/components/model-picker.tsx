import { useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { Provider, ProviderInfo } from '../../shared/types';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useI18n } from '../lib/i18n';
/** 把代理与模型合并为两栏选择器，已有会话保持 provider 固定。 */
export function ModelPicker({
  value,
  provider,
  providers,
  locked,
  onChange,
  disabled,
}: {
  value: string;
  provider: Provider;
  providers: ProviderInfo[];
  locked: boolean;
  onChange(provider: Provider, model: string): void;
  disabled?: boolean;
}) {
  const t = useI18n(),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(provider);
  const info = providers.find((p) => p.provider === category);
  const options = (info?.models || []).map((m) => ({ value: m.id, label: m.name }));
  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const selected =
    providers.find((p) => p.provider === provider)?.models.find((m) => m.id === value)?.name ||
    value ||
    t(provider);
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setQuery('');
        if (value) setCategory(provider);
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className="model-list-trigger"
            disabled={disabled}
            aria-label={t('model')}
          />
        }
      >
        <span>{selected}</span>
        <ChevronDown size={14} />
      </PopoverTrigger>
      <PopoverContent className="model-list-popup combined-model-popup" side="top" align="start">
        <nav className="model-providers" aria-label={t('provider')}>
          {providers
            .filter((p) => p.enabled !== false || p.provider === provider)
            .map((p) => (
              <Button
                key={p.provider}
                variant="ghost"
                aria-pressed={category === p.provider}
                disabled={locked && p.provider !== provider}
                onClick={() => {
                  setCategory(p.provider);
                  setQuery('');
                }}
              >
                {t(p.provider)}
              </Button>
            ))}
        </nav>
        <div className="model-browser">
          <div className="model-search">
            <Search size={17} />
            <Input
              autoFocus
              aria-label={t('searchModels')}
              placeholder={t('searchModels')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="model-options">
            {filtered.map((o) => (
              <Button
                variant="ghost"
                className="model-option"
                key={o.value}
                aria-pressed={category === provider && o.value === value}
                onClick={() => {
                  onChange(category, o.value);
                  setOpen(false);
                }}
              >
                <span>
                  {o.label}
                  <small>{t(category)}</small>
                </span>
                {category === provider && o.value === value && <Check size={16} />}
              </Button>
            ))}
            {!filtered.length && <p>{t('noResults')}</p>}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
