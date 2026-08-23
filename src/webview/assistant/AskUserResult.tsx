interface AskUserResultRow {
  readonly topic: string;
  readonly answer: string;
}

export function AskUserResult({
  data,
}: {
  readonly data: unknown;
}): React.JSX.Element | null {
  const result = readAskUserResult(data);
  if (result === null) {
    return null;
  }
  if (result.status === 'cancelled') {
    return (
      <section
        className="dvx-ask-result dvx-ask-result-cancelled"
        aria-label="Question cancelled"
      >
        <span>Question</span>
        <strong>Cancelled</strong>
      </section>
    );
  }
  return (
    <section className="dvx-ask-result" aria-label="Your answers">
      <header>Your answers</header>
      <dl>
        {result.answers.map(({ topic, answer }, index) => (
          <div key={`${topic}:${index}`}>
            <dt>{topic}</dt>
            <dd>{answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function readAskUserResult(
  value: unknown,
):
  | { readonly status: 'cancelled' }
  | { readonly status: 'answered'; readonly answers: AskUserResultRow[] }
  | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const status = Reflect.get(value, 'status');
  if (status === 'cancelled') {
    return { status };
  }
  const rawAnswers = Reflect.get(value, 'answers');
  if (
    status !== 'answered' ||
    !Array.isArray(rawAnswers) ||
    rawAnswers.length === 0 ||
    rawAnswers.length > 4
  ) {
    return null;
  }
  const answers: AskUserResultRow[] = [];
  for (const raw of rawAnswers) {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const topic = Reflect.get(raw, 'topic');
    const answer = Reflect.get(raw, 'answer');
    if (typeof topic !== 'string' || typeof answer !== 'string') {
      return null;
    }
    answers.push({ topic, answer });
  }
  return { status, answers };
}
