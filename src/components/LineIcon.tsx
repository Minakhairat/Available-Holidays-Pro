import { Cpu, Factory, Layers, Printer, Settings } from 'lucide-react';

export function LineIcon({
  icon,
  className = 'w-5 h-5',
}: {
  icon: string;
  className?: string;
}) {
  switch (icon) {
    case 'cpu':
      return <Cpu className={className} />;
    case 'settings':
      return <Settings className={className} />;
    case 'layers':
      return <Layers className={className} />;
    case 'printer':
      return <Printer className={className} />;
    default:
      return <Factory className={className} />;
  }
}
