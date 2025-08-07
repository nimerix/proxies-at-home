import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

export const exportProxyPagesToPdf = async (pages: HTMLElement[]) => {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: [8.5, 11],
  });

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    const canvas = await html2canvas(page, {
      scale: 3,
      useCORS: true,
      logging: false,
      scrollY: -window.scrollY,
    });

    const imgData = canvas.toDataURL('image/png');

    if (i > 0) pdf.addPage();

    pdf.addImage(imgData, 'PNG', 0, 0, 8.5, 11);
  }

  pdf.save('mtg-proxies.pdf');
};
