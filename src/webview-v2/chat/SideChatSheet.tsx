import { useRef, useState, type ComponentProps } from 'react';
import { ImagePlus } from 'lucide-react';
import { SideChatSheet as SideChatView } from '@droidvisx/chat-ui/chat/SideChatSheet';
import { MAX_BTW_TEXT_LENGTH, type BtwAskOptions, type SessionBtwState } from '../../shared/protocol/btwProtocol';
import type { ModelCatalogState } from '../../shared/protocol/settings';
import { IMAGE_MEDIA_TYPES } from '../../shared/protocol/bounds';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/selection';
import { BtwImages } from './BtwImages';
import { useBtwImages } from './useBtwImages';

export function SideChatSheet({ state, onAsk, modelCatalog, defaultModelId, ...props }: Omit<ComponentProps<typeof SideChatView>, 'state' | 'maxTextLength' | 'onAsk'> & {
  readonly state: SessionBtwState;
  readonly onAsk: (text: string, options?: BtwAskOptions) => void;
  readonly modelCatalog?: ModelCatalogState;
  readonly defaultModelId?: string;
}) {
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const selectedModel = chosenModel ?? defaultModelId;
  const unavailable = state.status === 'error' || state.status === 'unsupported';
  const images = useBtwImages(unavailable);
  const picker = useRef<HTMLInputElement>(null);
  const models = modelCatalog?.items ?? [];
  const missingModel = selectedModel !== undefined && !models.some((model) => model.id === selectedModel);
  return <SideChatView {...props} state={{ ...state, status: state.status === 'forking' ? 'preparing' : state.status }} maxTextLength={MAX_BTW_TEXT_LENGTH}
    notice={images.reading ? 'Preparing images…' : images.notice ?? props.notice}
    hasAttachments={images.images.length > 0} sendDisabled={images.reading > 0}
    onPaste={images.onPaste} onDrop={images.onDrop} onDragOver={images.onDragOver}
    attachments={<BtwImages images={images.images} previews={images.previews} onRemove={images.remove} />}
    renderImages={(items) => <BtwImages images={items} previews={images.previews} />}
    composerActions={<>
      <input hidden type="file" ref={picker} accept={IMAGE_MEDIA_TYPES.join(',')} multiple onChange={(event) => {
        images.add(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = '';
      }} />
      <Button variant="ghost" size="icon-sm" disabled={unavailable} title="Attach images" aria-label="Attach images to side question" onClick={() => picker.current?.click()}><ImagePlus /></Button>
      <Select value={selectedModel ?? ''} onValueChange={setChosenModel} disabled={unavailable || !models.length}>
        <SelectTrigger aria-label="Side conversation model" title="Model for side questions" className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-xs">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent side="top" align="end" className="max-h-80 max-w-[min(360px,calc(100vw-24px))]">
          {missingModel ? <SelectItem value={selectedModel!}>{selectedModel}</SelectItem> : null}
          {models.map((model) => <SelectItem key={model.id} value={model.id}>{model.displayName}</SelectItem>)}
        </SelectContent>
      </Select>
    </>}
    onAsk={(text) => {
      if (images.reading > 0) return;
      onAsk(text, { ...(selectedModel === undefined ? {} : { modelId: selectedModel }),
        ...(images.images.length ? { images: images.images } : {}) });
      images.sent();
    }} />;
}
