import styles from "./PostBody.module.css"

type PostBodyProps = {
  html: string
}

export default function PostBody({ html }: PostBodyProps) {
  return (
    <div
      className={styles.body}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
