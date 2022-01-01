import { CSSProperties } from 'react';
import './ProgressBar.scss';

const ProgressBar = (props: {
    children?: any,
    border?: boolean,
    percentage?: number,
    color?: string,
    textColor?: string,
    className?: string
}) => {
    const { className, color = '#999', textColor = 'black', percentage = 100, border = true, children } = props;
    const style: CSSProperties = {
        color: textColor,
        borderColor: color,
        borderStyle: border ? 'solid' : undefined,
        background: `linear-gradient(90deg, ${color} ${percentage}%,transparent ${percentage}%)`
    }
    return <div className={`progress-bar ${className}`} style={style}>{children}</div>
}

export default ProgressBar;