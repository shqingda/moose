import { useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import { useI18n } from '../lib/i18n';
export interface Confirmation {
  title: string;
  description: string;
  destructive?: boolean;
  action(): Promise<unknown>;
}
/** 承接需要确认的操作，等待异步结果并将失败交给统一错误提示。 */
export function ConfirmDialog({
  value,
  onClose,
  onError,
}: {
  value?: Confirmation;
  onClose(): void;
  onError(error: string): void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const t = useI18n(),
    [pending, setPending] = useState(false);
  return (
    <AlertDialog
      open={!!value}
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent initialFocus={cancel}>
        <AlertDialogHeader>
          <AlertDialogTitle>{value?.title}</AlertDialogTitle>
          <AlertDialogDescription>{value?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel ref={cancel} disabled={pending}>
            {t('cancel')}
          </AlertDialogCancel>
          <Button
            variant={value?.destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() => {
              if (!value) return;
              setPending(true);
              void value
                .action()
                .then(onClose)
                .catch((error) => onError(String(error)))
                .finally(() => setPending(false));
            }}
          >
            {t('confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
