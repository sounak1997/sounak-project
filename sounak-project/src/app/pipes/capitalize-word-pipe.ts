import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'capitalizeWord',
  standalone: true
})
export class CapitalizeWordPipe implements PipeTransform {

  transform(value: unknown, ...args: unknown[]): unknown {
    if (!value) {
      return '';
    }

    // Convert to string and trim
    const str = String(value).trim();

    // Split the string into words, map to capitalize the first letter of each word,
    // and then join them back together.
    return str.split(' ')
      .map(word => {
        if (!word) return '';
        // Capitalize the first letter and concatenate the rest of the word
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  }

}
