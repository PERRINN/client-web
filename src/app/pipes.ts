import { Pipe, PipeTransform } from '@angular/core'

@Pipe({name:'blankIfZero'})
export class BlankIfZeroPipe implements PipeTransform {
  transform(value:any):string{
    let newValue=value==0?'':value.toString()
    return newValue
  }
}

@Pipe({
  name: 'linky'
})
export class LinkyPipe implements PipeTransform {

  transform(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    /*
     * We look for:
     *  - e-mail addresses
     *  - URLs with http:// or https://
     *  - URLs starting with www.
     *  - domains without protocol (google.com)
     *
     * Order is important: e-mails are searched
     * before domains.
     */
    const linkRegex =
      /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})|(https?:\/\/[^\s<]+)|(www\.[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s<]*)?)|((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s<]*)?)/gi;

    let result = '';
    let lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(value)) !== null) {
      // Text before the link
      result += this.escapeHtml(value.substring(lastIndex, match.index));

      const matchedText = match[0];

      // E-mail address
      if (match[1]) {
        const email = matchedText;

        result +=
          `<a href="mailto:${this.escapeAttribute(email)}">` +
          `${this.escapeHtml(email)}` +
          `</a>`;
      }

      // URL with http:// or https://
      else if (match[2]) {
        const url = this.removeTrailingPunctuation(matchedText);

        result += this.createUrlLink(url.value, url.trailing);
      }

      // www.google.com
      else if (match[3]) {
        const url = this.removeTrailingPunctuation(matchedText);

        result += this.createUrlLink(
          `https://${url.value}`,
          url.trailing,
          url.value
        );
      }

      // google.com
      else if (match[4]) {
        const url = this.removeTrailingPunctuation(matchedText);

        result += this.createUrlLink(
          `https://${url.value}`,
          url.trailing,
          url.value
        );
      }

      lastIndex = match.index + matchedText.length;
    }

    // Remaining text
    result += this.escapeHtml(value.substring(lastIndex));

    return result;
  }

  private createUrlLink(
    href: string,
    trailing: string,
    displayedUrl?: string
  ): string {
    const text = displayedUrl ?? href;

    return (
      `<a href="${this.escapeAttribute(href)}" ` +
      `target="_blank" ` +
      `rel="noopener noreferrer">` +
      `${this.escapeHtml(text)}` +
      `</a>` +
      trailing
    );
  }

  private removeTrailingPunctuation(value: string): {
    value: string;
    trailing: string;
  } {
    const match = value.match(/^(.+?)([.,!?;:)]*)$/);

    if (!match) {
      return {
        value,
        trailing: ''
      };
    }

    return {
      value: match[1],
      trailing: match[2]
    };
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private escapeAttribute(value: string): string {
    return this.escapeHtml(value);
  }
}
