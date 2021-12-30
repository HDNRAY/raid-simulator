import './Button.scss';

const Button = (props: {
    children?: any,
    className?: string,
    onClick?: any
}) => {
    const { className, children, onClick } = props;
    return <button onClick={onClick} className={`common-button ${className}`}>{children}</button>
}

export default Button;