import { useRef, type ComponentProps } from 'react';
import { ImagePlus, LoaderCircle, Unplug } from 'lucide-react';
import { SideChatSheet as SideChatView } from '@droidvisx/chat-ui/chat/SideChatSheet';
import { MAX_BTW_TEXT_LENGTH, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import type { ModelCatalogState } from '../../shared/protocol/settings';
import type { ConnectionState } from '../../shared/protocol/shell';
import { IMAGE_MEDIA_TYPES } from '../../shared/protocol/bounds';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/overlays';
import { BtwModelSelect, type BtwReasoningControl } from './btw/BtwModelSelect';
import { BtwImages } from './BtwImages';
import type { useBtwImages } from './useBtwImages';

export function SideChatSheet({ state, images, modelCatalog, selectedModel, onModelChange, reasoning, onOpenModels, connectionStatus, sending = false, ...props }: Omit<ComponentProps<typeof SideChatView>, 'state' | 'maxTextLength'> & {
  readonly state: SessionBtwState;
  readonly images: ReturnType<typeof useBtwImages>;
  readonly modelCatalog?: ModelCatalogState;
  readonly connectionStatus?: ConnectionState['status'];
  readonly selectedModel?: string;
  readonly onModelChange: (modelId: string) => void;
  readonly reasoning?: BtwReasoningControl;
  readonly onOpenModels?: () => void;
  readonly sending?: boolean;
}) {
  const unavailable = state.status === 'error' || state.status === 'unsupported';
  const picker = useRef<HTMLInputElement>(null);
  const models = modelCatalog?.items ?? [];
  const selected = models.find((model) => model.id === selectedModel);
  const modelsLoading = modelCatalog?.status === 'loading';
  const offline = connectionStatus === 'unavailable';
  const statusLabel = offline ? 'Main conversation offline. Reconnect there to load models.' : 'Loading available models…';
  const modelNotice = modelCatalog && modelCatalog.status !== 'ready'
    ? modelCatalog.status === 'loading' ? null : modelCatalog.message
    : modelCatalog && !selected ? 'Choose an available model before sending a side question.'
    : selected?.disabled ? selected.disabledReason
    : selected?.supportsImages === false && images.images.length > 0
      ? 'This model does not support images. Remove the images or choose another model.' : null;
  return <SideChatView {...props} state={{ ...state, status: state.status === 'forking' ? 'preparing' : state.status }} maxTextLength={MAX_BTW_TEXT_LENGTH}
    notice={images.reading ? 'Preparing images…' : modelNotice ?? images.notice ?? props.notice}
    composerStatus={modelsLoading ? <Tooltip content={statusLabel}>
      <span role="status" aria-label={statusLabel} tabIndex={0}
        className="inline-flex size-5 cursor-help items-center justify-center rounded-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {offline ? <Unplug aria-hidden="true" className="size-3.5" />
          : <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />}
      </span>
    </Tooltip> : undefined}
    hasAttachments={images.images.length > 0} sendDisabled={images.reading > 0 || sending || modelsLoading || Boolean(modelNotice)}
    onPaste={images.onPaste} onDrop={images.onDrop} onDragOver={images.onDragOver}
    attachments={<BtwImages images={images.images} previews={images.previews} onRemove={images.remove} />}
    renderImages={(items) => <BtwImages images={items} previews={images.previews} />}
    composerActions={<>
      <input hidden type="file" ref={picker} accept={IMAGE_MEDIA_TYPES.join(',')} multiple onChange={(event) => {
        images.add(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '';
      }} />
      <Button variant="ghost" size="icon-sm" disabled={unavailable || selected?.disabled || selected?.supportsImages === false} title={selected?.supportsImages === false ? 'This model does not support images' : 'Attach images'} aria-label="Attach images to side question" onClick={() => picker.current?.click()}><ImagePlus /></Button>
      <BtwModelSelect catalog={modelCatalog} value={selectedModel} onChange={onModelChange}
        disabled={unavailable} reasoning={reasoning} onOpenModels={onOpenModels} />
    </>} />;
}
