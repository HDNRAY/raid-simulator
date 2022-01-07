import { CSSProperties } from 'react';
import { unit } from 'util/utils';
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
    const positionOffset = {
        // left: border ? unit(-1) : 0,
        top: border ? unit(-1) : 0,
    }
    const outerStyle: CSSProperties = {
        borderColor: color,
        borderStyle: border ? 'solid' : undefined,
        ...positionOffset
    }
    const textOuterStyle = {
        color
    }
    const innerStyle: CSSProperties = {
        backgroundColor: color,
        borderColor: 'transparent',
        borderTopStyle: border ? 'solid' : undefined,
        borderBottomStyle: border ? 'solid' : undefined,
        width: percentage === 100 ? `calc(${percentage}% + ${unit(2)})` : `${percentage}%`,
        ...positionOffset
    }
    const textInnerStyle = {
        color: textColor
    }
    return <div className={`progress-bar-outer ${className}`} style={outerStyle}>
        <div className='text-outer' style={textOuterStyle}>{children}</div>
        <div className={`progress-bar-inner`} style={innerStyle}>
            <div className='text-inner' style={textInnerStyle}>{children}</div>
        </div>
    </div>
}

export default ProgressBar;