import { useRef, type ComponentProps } from 'react';
import { ImagePlus } from 'lucide-react';
import { SideChatSheet as SideChatView } from '@droidvisx/chat-ui/chat/SideChatSheet';
import { MAX_BTW_TEXT_LENGTH, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import type { ModelCatalogState } from '../../shared/protocol/settings';
import { IMAGE_MEDIA_TYPES } from '../../shared/protocol/bounds';
import { Button } from '../ui/button';
import { ModelSourceSelect } from '../models/ModelSourceSelect';
import { BtwImages } from './BtwImages';
import type { useBtwImages } from './useBtwImages';

export function SideChatSheet({ state, images, modelCatalog, selectedModel, onModelChange, sending = false, ...props }: Omit<ComponentProps<typeof SideChatView>, 'state' | 'maxTextLength'> & {
  readonly state: SessionBtwState;
  readonly images: ReturnType<typeof useBtwImages>;
  readonly modelCatalog?: ModelCatalogState;
  readonly selectedModel?: string;
  readonly onModelChange: (modelId: string) => void;
  readonly sending?: boolean;
}) {
  const unavailable = state.status === 'error' || state.status === 'unsupported';
  const picker = useRef<HTMLInputElement>(null);
  const models = modelCatalog?.items ?? [];
  const selected = models.find((model) => model.id === selectedModel);
  const modelNotice = modelCatalog && modelCatalog.status !== 'ready'
    ? modelCatalog.status === 'loading' ? 'Loading available models…' : modelCatalog.message
    : modelCatalog && !selected ? 'Choose an available model before sending a side question.'
    : selected?.disabled ? selected.disabledReason
    : selected?.supportsImages === false && images.images.length > 0
      ? 'This model does not support images. Remove the images or choose another model.' : null;
  return <SideChatView {...props} state={{ ...state, status: state.status === 'forking' ? 'preparing' : state.status }} maxTextLength={MAX_BTW_TEXT_LENGTH}
    notice={images.reading ? 'Preparing images…' : modelNotice ?? images.notice ?? props.notice}
    hasAttachments={images.images.length > 0} sendDisabled={images.reading > 0 || sending || Boolean(modelNotice)}
    onPaste={images.onPaste} onDrop={images.onDrop} onDragOver={images.onDragOver}
    attachments={<BtwImages images={images.images} previews={images.previews} onRemove={images.remove} />}
    renderImages={(items) => <BtwImages images={items} previews={images.previews} />}
    composerActions={<>
      <input hidden type="file" ref={picker} accept={IMAGE_MEDIA_TYPES.join(',')} multiple onChange={(event) => {
        images.add(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '';
      }} />
      <Button variant="ghost" size="icon-sm" disabled={unavailable || selected?.disabled || selected?.supportsImages === false} title={selected?.supportsImages === false ? 'This model does not support images' : 'Attach images'} aria-label="Attach images to side question" onClick={() => picker.current?.click()}><ImagePlus /></Button>
      <ModelSourceSelect label="Side conversation model" value={selectedModel} onChange={onModelChange}
        disabled={unavailable || modelCatalog?.status !== 'ready'} placeholder="Model" side="top" align="end"
        className="ml-auto h-7 w-auto max-w-[180px] flex-initial gap-1 border-0 bg-transparent px-1 text-xs"
        models={models.map((model) => ({ ...model,
          description: model.disabledReason ?? (model.supportsImages ? 'Images supported' : 'Text only') }))} />
    </>} />;
}
