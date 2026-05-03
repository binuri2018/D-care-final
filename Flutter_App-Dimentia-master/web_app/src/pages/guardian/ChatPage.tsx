import SendIcon from '@mui/icons-material/Send';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../api/session';
import { useAuth } from '../../context/AuthContext';
import { useDemoPhoneLayout } from '../../context/DemoLayoutContext';

type ChatRow = {
  query?: string;
  response?: string;
  source?: string;
  createdAt?: string;
};

type Bubble = {
  text: string;
  isUser: boolean;
  sourceLabel?: string;
};

function sourceLabel(source?: string) {
  return source === 'fallback' ? 'Local AI model' : 'Cloud LLM';
}

export function ChatPage() {
  const { http, selectedPatientId } = useAuth();
  const demoPhone = useDemoPhoneLayout();
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const intro =
    'Hello! I am your AI clinical assistant. Ask about patient records, alerts, or cognitive trends.';

  const loadHistory = useCallback(
    async (patientId: string) => {
      setHistoryLoading(true);
      setError(null);
      try {
        const { data } = await http.get<ChatRow[]>('/llm/chat-history', {
          params: { patientId, limit: 100 },
        });
        const next: Bubble[] = [];
        for (const row of data || []) {
          if (row.query) next.push({ text: row.query, isUser: true });
          if (row.response)
            next.push({
              text: row.response,
              isUser: false,
              sourceLabel: sourceLabel(row.source),
            });
        }
        setMessages(next.length ? next : [{ text: intro, isUser: false }]);
      } catch (e) {
        setMessages([{ text: intro, isUser: false }]);
        setError(getErrorMessage(e));
      } finally {
        setHistoryLoading(false);
      }
    },
    [http]
  );

  useEffect(() => {
    const pid = selectedPatientId?.trim();
    if (!pid) {
      setMessages([{ text: 'Select a patient ID in Settings first.', isUser: false }]);
      return;
    }
    void loadHistory(pid);
  }, [selectedPatientId, loadHistory]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const q = input.trim();
    if (q.length < 5 || sending) return;
    const pid = selectedPatientId?.trim();
    if (!pid) {
      setError('Select a patient ID in Settings first.');
      return;
    }
    setSending(true);
    setInput('');
    setError(null);
    try {
      await http.post('/llm/query-records', { patientId: pid, query: q });
      await loadHistory(pid);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Stack
      spacing={2}
      sx={{
        ...(demoPhone
          ? { height: 400, display: 'flex', flexDirection: 'column', minHeight: 0 }
          : { height: 'calc(100vh - 140px)', minHeight: 400 }),
      }}
    >
      <Typography variant="h5" fontWeight={800}>
        AI Chat
      </Typography>
      {error && <Alert severity="warning">{error}</Alert>}
      <Card variant="outlined" sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {historyLoading ? (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={1.5}>
            {messages.map((m, idx) => (
              <Box
                key={`${idx}-${m.text.slice(0, 12)}`}
                sx={{
                  alignSelf: m.isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  bgcolor: m.isUser ? 'primary.main' : 'grey.100',
                  color: m.isUser ? 'primary.contrastText' : 'text.primary',
                  px: 2,
                  py: 1.25,
                  borderRadius: 2,
                }}
              >
                {!m.isUser && m.sourceLabel && (
                  <Typography variant="caption" sx={{ opacity: 0.85, display: 'block', mb: 0.5 }}>
                    {m.sourceLabel}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {m.text}
                </Typography>
              </Box>
            ))}
            <div ref={bottomRef} />
          </Stack>
        )}
      </Card>
      <Stack direction="row" spacing={1}>
        <TextField
          fullWidth
          placeholder="Ask a question (min 5 characters)…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void send())}
          disabled={sending || historyLoading}
          multiline
          maxRows={3}
        />
        <Button
          variant="contained"
          sx={{ minWidth: 100 }}
          endIcon={<SendIcon />}
          onClick={() => void send()}
          disabled={sending || historyLoading || input.trim().length < 5}
        >
          Send
        </Button>
      </Stack>
    </Stack>
  );
}
