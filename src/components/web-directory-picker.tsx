import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Folder, Home } from 'lucide-react';
import { webRequest } from '../lib/web-api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { IconButton } from './common';

type Listing = { path: string; parent: string; directories: { name: string; path: string }[] };

/** Browses the execution host, without uploading or copying a project. */
export function WebDirectoryPicker({
  zh,
  onChoose,
}: {
  zh: boolean;
  onChoose(path: string): void;
}) {
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<Listing>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  async function browse(path: string) {
    const request = ++sequence.current;
    setBusy(true);
    setError('');
    try {
      const result = (await webRequest('webDirectories', { path })) as Listing;
      if (request !== sequence.current) return;
      setListing(result);
      setPath(result.path);
    } catch (error) {
      if (request === sequence.current)
        setError(String(error instanceof Error ? error.message : error));
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    void browse('');
    return () => {
      sequence.current++;
    };
  }, []);
  return (
    <div className="web-directory-picker">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void browse(path.trim());
        }}
        className="flex items-center gap-2"
      >
        <IconButton label={zh ? '主目录' : 'Home directory'} onClick={() => void browse('')}>
          <Home />
        </IconButton>
        <IconButton
          label={zh ? '上一级' : 'Parent directory'}
          disabled={!listing || listing.parent === listing.path || busy}
          onClick={() => void browse(listing!.parent)}
        >
          <ArrowUp />
        </IconButton>
        <Input
          id="web-project"
          aria-label={zh ? '服务端目录' : 'Server directory'}
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={busy || !path.trim().startsWith('/')}>
          {zh ? '前往' : 'Go'}
        </Button>
      </form>
      <div className="web-directory-list" aria-busy={busy} aria-label={zh ? '文件夹' : 'Folders'}>
        {listing?.directories.map((entry) => (
          <Button
            key={entry.path}
            variant="ghost"
            disabled={busy}
            onClick={() => void browse(entry.path)}
            className="w-full justify-start"
          >
            <Folder />
            <span className="truncate">{entry.name}</span>
          </Button>
        ))}
        {!busy && listing?.directories.length === 0 && (
          <p>{zh ? '没有子文件夹' : 'No subfolders'}</p>
        )}
        {busy && <p role="status">{zh ? '正在读取…' : 'Loading…'}</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="flex justify-end">
        <Button
          disabled={busy || !listing || path !== listing.path}
          onClick={() => listing && onChoose(listing.path)}
        >
          {zh ? '选择此文件夹' : 'Select folder'}
        </Button>
      </div>
    </div>
  );
}
