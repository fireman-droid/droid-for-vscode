import { useRef, type ComponentProps } from 'react';
import { ImagePlus } from 'lucide-react';
import { SideChatSheet as SideChatView } from '@droidvisx/chat-ui/chat/SideChatSheet';
import { MAX_BTW_TEXT_LENGTH, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import type { ModelCatalogState } from '../../shared/protocol/settings';
import { IMAGE_MEDIA_TYPES } from '../../shared/protocol/bounds';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
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
  const modelLabel = models.find((model) => model.id === selectedModel)?.displayName ?? selectedModel ?? 'Model';
  const missingModel = selectedModel !== undefined && !models.some((model) => model.id === selectedModel);
  return <SideChatView {...props} state={{ ...state, status: state.status === 'forking' ? 'preparing' : state.status }} maxTextLength={MAX_BTW_TEXT_LENGTH}
    notice={images.reading ? 'Preparing images…' : images.notice ?? props.notice}
    hasAttachments={images.images.length > 0} sendDisabled={images.reading > 0 || sending}
    onPaste={images.onPaste} onDrop={images.onDrop} onDragOver={images.onDragOver}
    attachments={<BtwImages images={images.images} previews={images.previews} onRemove={images.remove} />}
    renderImages={(items) => <BtwImages images={items} previews={images.previews} />}
    composerActions={<>
      <input hidden type="file" ref={picker} accept={IMAGE_MEDIA_TYPES.join(',')} multiple onChange={(event) => {
        images.add(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '';
      }} />
      <Button variant="ghost" size="icon-sm" disabled={unavailable} title="Attach images" aria-label="Attach images to side question" onClick={() => picker.current?.click()}><ImagePlus /></Button>
      <Select value={selectedModel ?? ''} onValueChange={onModelChange} disabled={unavailable || !models.length}>
        <SelectTrigger aria-label="Side conversation model" title={`Model for side questions: ${modelLabel}`} className="ml-auto h-7 min-w-0 max-w-[180px] flex-initial gap-1 border-0 bg-transparent px-1 text-xs">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent side="top" align="end" className="max-h-80 w-[240px] max-w-[min(360px,calc(100vw-24px))]">
          {missingModel ? <SelectItem value={selectedModel!}>{selectedModel}</SelectItem> : null}
          {models.map((model) => <SelectItem key={model.id} value={model.id}>{model.displayName}</SelectItem>)}
        </SelectContent>
      </Select>
    </>} />;
}
