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
    const outerStyle: CSSProperties = {
        borderColor: color,
        borderStyle: border ? 'solid' : undefined,
    }
    const innerStyle: CSSProperties = {
        backgroundColor: color,
        borderColor: 'transparent',
        borderTopStyle: border ? 'solid' : undefined,
        borderBottomStyle: border ? 'solid' : undefined,
        width: `${percentage}%`
    }
    return <div className={`progress-bar-outer ${className}`} style={outerStyle}>
        <div className='text-outer' style={{ color }}>{children}</div>
        <div className={`progress-bar-inner`} style={innerStyle}>
            <div className='text-inner' style={{ color: textColor }}>{children}</div>
        </div>
    </div>
}

export default ProgressBar;