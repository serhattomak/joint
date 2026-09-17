import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from 'cn';

/* Anahtar — kâğıt şerit üzerinde kayan blok. */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'group inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-input bg-muted p-0.5 transition-colors duration-150 ease-paper',
        'data-checked:border-primary data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-45',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="block size-4 rounded-full bg-card transition-transform duration-150 ease-paper group-data-checked:translate-x-4"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
