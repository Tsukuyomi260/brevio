import { CornerRightUp, Mic } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { useAutoResizeTextarea } from '@/components/hooks/use-auto-resize-textarea';

interface AIInputProps {
  id?: string;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  disabled?: boolean;
  onSubmit?: (value: string) => void;
  className?: string;
}

export function AIInput({
  id = 'ai-input',
  placeholder = 'Type your message...',
  minHeight = 52,
  maxHeight = 200,
  disabled = false,
  onSubmit,
  className,
}: AIInputProps) {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight, maxHeight });
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = () => {
    if (!inputValue.trim() || disabled) return;
    onSubmit?.(inputValue);
    setInputValue('');
    adjustHeight(true);
  };

  return (
    <div className={cn('w-full py-2', className)}>
      <div className="relative max-w-xl w-full mx-auto">
        <Textarea
          id={id}
          placeholder={placeholder}
          disabled={disabled}
          style={{ minHeight, maxHeight }}
          className={cn(
            'max-w-xl bg-black/5 rounded-3xl pl-6 pr-16',
            'placeholder:text-black/50',
            'border-none ring-black/20',
            'text-black text-wrap',
            'overflow-y-auto resize-none',
            'focus-visible:ring-0 focus-visible:ring-offset-0',
            'transition-[height] duration-100 ease-out',
            'leading-[1.2] py-[16px]',
            'disabled:opacity-60',
            '[&::-webkit-resizer]:hidden',
          )}
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            adjustHeight();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />

        <div
          className={cn(
            'absolute top-1/2 -translate-y-1/2 rounded-xl bg-black/5 py-1 px-1 transition-all duration-200',
            inputValue ? 'right-10' : 'right-3',
          )}
        >
          <Mic className="w-4 h-4 text-black/70" />
        </div>

        <button
          onClick={handleSubmit}
          type="button"
          disabled={disabled}
          className={cn(
            'absolute top-1/2 -translate-y-1/2 right-3',
            'rounded-xl bg-black/5 py-1 px-1',
            'transition-all duration-200',
            inputValue ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none',
          )}
        >
          <CornerRightUp className="w-4 h-4 text-black/70" />
        </button>
      </div>
    </div>
  );
}
