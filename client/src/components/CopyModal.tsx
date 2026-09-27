import { useEffect, useRef } from 'react';
import { Modal } from './Modal';

/** Last-resort sharing: the result text, pre-selected, for a manual copy. */
export function CopyModal({ text, onClose }: { text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <Modal title="Copy your result" onClose={onClose} className="copy">
      <p>Copying isn&rsquo;t available here. Select the text below and copy it to share your result.</p>
      <textarea
        ref={ref}
        className="copy__text"
        readOnly
        value={text}
        rows={Math.min(10, text.split('\n').length + 1)}
        aria-label="Your result"
        onFocus={(event) => event.currentTarget.select()}
      />
    </Modal>
  );
}
