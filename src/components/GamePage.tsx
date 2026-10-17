import type { ReactNode } from 'react';

type GamePageHeroProps = {
  className?: string;
  background: ReactNode;
  content: ReactNode;
  showcase?: ReactNode;
};

/**
 * Shared stage for every game page. Games keep complete control over their
 * artwork and content, while the shell guarantees a stable two-column layout.
 */
export function GamePageHero({ className = '', background, content, showcase }: GamePageHeroProps) {
  return (
    <section className={`game-hero game-page-hero ${className}`}>
      <div className="game-page-hero-background">{background}</div>
      <div className="game-hero-shade" />
      <div className={`game-page-hero-layout ${showcase ? 'with-showcase' : ''}`}>
        <div className="game-page-hero-copy">{content}</div>
        {showcase && <div className="game-page-hero-showcase">{showcase}</div>}
      </div>
    </section>
  );
}
