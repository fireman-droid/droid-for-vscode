import { useEffect, useState } from 'react';
import { useUiEnvironment } from '../environment';
import { requestSyntax } from './syntaxQueue';
import type { SyntaxRequest, SyntaxResponse } from './syntaxProtocol';

export function useSyntaxHighlight(request: Omit<SyntaxRequest, 'id'>) {
  const { createSyntaxWorker } = useUiEnvironment();
  const [result, setResult] = useState<{ request: typeof request; value: SyntaxResponse }>();
  useEffect(() => {
    if (!createSyntaxWorker || !request.documents.some(document => document.text.trim())) return;
    return requestSyntax(createSyntaxWorker, request, value => {
      if (value.error) console.warn('Source highlighting:', value.error);
      setResult({ request, value });
    });
  }, [createSyntaxWorker, request]);
  return result?.request === request ? result.value : undefined;
}
