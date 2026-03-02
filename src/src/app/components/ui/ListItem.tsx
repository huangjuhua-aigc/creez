import { cn } from '../../utils/cn';

interface ListItemProps {
    onClick?: () => void;
    isActive?: boolean;
    className?: string;
    children: React.ReactNode;
}

export function ListItem({ onClick, isActive, className, children }: ListItemProps) {
    return (
        <div 
            onClick={onClick}
            className={cn(
                "flex items-center gap-3 px-3 py-3 cursor-pointer relative transition-colors",
                isActive ? "bg-[#C6C6C6]" : "hover:bg-[#D9D9D9]",
                className
            )}
        >
            {children}
        </div>
    );
}
